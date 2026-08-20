#version 300 es
precision highp float;
//__DEFINES__

/**
 * Water surface pass (§8.2).
 *
 * Renders into a W x 1 target: the scene is side-on, so the surface is a height
 * field along x and one row holds everything the subsurface pass needs. This is
 * why the water costs almost nothing on a low-tier phone.
 *
 * OCTAVES is injected at build time from the quality tier — a #define, not a
 * uniform, so there is no dynamic loop on the hot path.
 */

#ifndef OCTAVES
#define OCTAVES 3
#endif

in vec2 vTextureCoord;
in vec2 vUV;
out vec4 fragColor;

uniform float uTime;
uniform float uWindKt;       // live wind speed
uniform float uWindDir;      // -1 .. 1, chop direction along x
uniform float uWorldWidth;   // world units across the viewport
uniform float uDt;
uniform sampler2D uTexture;  // previous frame's row: the foam accumulation buffer

// Foam sources: xy = (world x, strength), z = radius. Structure edges and a
// hooked fish's surface thrash both write here.
#define FOAM_SOURCES 8
uniform vec3 uFoam[FOAM_SOURCES];
uniform int uFoamCount;

// These four constants are mirrored exactly in sim/water.ts. The simulation
// cannot read the GPU back, so it recomputes the same wave field on the CPU to
// float the lure and land the line. If you change one, change both.
const float BASE_WAVELENGTH = 3.1;
const float WAVE_LACUNARITY = 1.87;
const float WAVE_GAIN = 0.040;
const float HEIGHT_ENCODE = 2.0;

/** Per-octave wave parameters. Amplitude is in metres, as it is on the CPU. */
void octave(int i, float windScale, out float k, out float amp, out float speed, out float phase) {
  float n = float(i);
  float wl = BASE_WAVELENGTH / pow(WAVE_LACUNARITY, n);
  k = 6.2831853 / wl;
  // Deep-water dispersion: longer waves travel faster. Keeps the set coherent.
  speed = sqrt(9.81 / k);
  amp = windScale * WAVE_GAIN * pow(0.56, n) * wl;
  phase = n * 2.399;
}

/**
 * Gerstner in one dimension. Horizontal bunching makes crests sharp and troughs
 * broad, which is the whole reason to use Gerstner over a sine stack; solving
 * for the parameter that lands on this column costs three fixed-point steps.
 */
float surfaceHeight(float x, float windScale, out float slope) {
  float steep = clamp(windScale * 0.85, 0.0, 1.0);

  float u = x;
  for (int iter = 0; iter < 3; iter++) {
    float dx = 0.0;
    float ddx = 0.0;
    for (int i = 0; i < OCTAVES; i++) {
      float k, amp, speed, phase;
      octave(i, windScale, k, amp, speed, phase);
      float t = k * u - speed * uTime * uWindDir + phase;
      float q = steep * amp;
      dx += -q * sin(t);
      ddx += -q * k * cos(t);
    }
    // Newton step toward u + dx(u) == x
    float f = u + dx - x;
    u -= f / max(0.25, 1.0 + ddx);
  }

  float h = 0.0;
  slope = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    float k, amp, speed, phase;
    octave(i, windScale, k, amp, speed, phase);
    float t = k * u - speed * uTime * uWindDir + phase;
    h += amp * cos(t);
    slope += -amp * k * sin(t);
  }
  return h;
}

void main() {
  float x = vUV.x * uWorldWidth;
  float windScale = clamp(uWindKt / 22.0, 0.06, 1.0);

  float slope;
  float h = surfaceHeight(x, windScale, slope);

  // Foam: sources deposit, the buffer decays toward zero over ~2s (§8.2).
  float prev = texture(uTexture, vTextureCoord).b;
  float deposit = 0.0;
  for (int i = 0; i < FOAM_SOURCES; i++) {
    if (i >= uFoamCount) break;
    vec3 f = uFoam[i];
    float d = abs(x - f.x);
    deposit += f.y * smoothstep(f.z, 0.0, d);
  }
  // Chop alone whips up a little foam once the wind is genuinely up.
  deposit += smoothstep(0.55, 1.0, windScale) * max(0.0, -slope) * 0.20;

  float decay = exp(-uDt / 0.72);           // ~2s to visually clear
  float foam = clamp(prev * decay + deposit * uDt * 3.0, 0.0, 1.0);

  // Encode: R height in metres (biased), G slope, B foam, A crest sharpness.
  float crest = clamp(h / max(0.0001, windScale * 0.13), -1.0, 1.0);
  fragColor = vec4(h * HEIGHT_ENCODE + 0.5, slope * 0.25 + 0.5, foam, crest * 0.5 + 0.5);
}
