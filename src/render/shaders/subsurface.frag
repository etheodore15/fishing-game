#version 300 es
precision highp float;
//__DEFINES__

/**
 * Water subsurface + composite pass (§8.2).
 *
 * Consumes the W x 1 surface row and the offscreen underwater scene, and
 * produces the finished water: refraction, depth fog toward palette[0],
 * caustics, foam, specular and the midday glare lobe.
 *
 * There is no time-of-day branch anywhere in here. The shader is handed a
 * resolved six-colour palette and a light angle; it has no idea what hour it is.
 */

#ifndef CAUSTICS
#define CAUSTICS 1
#endif

in vec2 vTextureCoord;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSurface;   // W x 1: R height, G slope, B foam, A crest
uniform sampler2D uTexture;   // underwater scene, pre-refraction (filter input)
uniform vec3 uPalette[6];     // linear RGB, resolved on the CPU
uniform float uTime;
uniform float uWaterlineY;    // 0-1 screen space, from live tide height
uniform float uPixelHeight;   // 1.0 / viewport height
uniform float uWorldHeight;   // world units down the viewport
uniform float uLightAngle;    // radians; drives horizontal light position
uniform float uLightElev;     // 0-1, horizon to zenith
uniform float uLightLevel;    // 0-1
uniform float uGlare;         // 0-1 midday glare strength
uniform float uAspect;

const float REFRACT_STRENGTH = 0.035;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  float n = hash21(p);
  return vec2(n, hash21(p + n));
}

/** One voronoi layer. Two of these summed give the caustic web. */
float voronoi(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float best = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 pt = o + hash22(cell + o) - f;
      best = min(best, dot(pt, pt));
    }
  }
  return sqrt(best);
}

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec4 surf = texture(uSurface, vec2(vUV.x, 0.5));
  float heightM = (surf.r - 0.5) / 2.0;   // metres, matching sim/water.ts
  float slope = (surf.g - 0.5) * 4.0;
  float foam = surf.b;
  float crest = (surf.a - 0.5) * 2.0;

  // The waterline for this column: still level plus wave displacement.
  // Screen y runs down, so a crest is a smaller y.
  float lineY = uWaterlineY - heightM / uWorldHeight;
  float below = vUV.y - lineY;

  vec3 col;

  if (below < 0.0) {
    // ---- above water: flat sky band, one hard light source ----
    float t = clamp((-below) / max(0.0001, lineY), 0.0, 1.0);
    col = mix(uPalette[4], uPalette[3], smoothstep(0.0, 1.0, t) * 0.35);

    // Light source disc. Screen-printed: hard edge, no bloom gradient.
    // Elevation is mapped into the sky band itself, so the sun is always in
    // frame — the band is only a quarter of the screen and a sun placed in
    // world terms sits above the top of it all morning.
    vec2 sunPos = vec2(0.5 + sin(uLightAngle) * 0.42, lineY * (1.0 - clamp(uLightElev, 0.0, 1.0)));
    float d = length((vUV - sunPos) * vec2(uAspect, 1.0));
    col = mix(col, uPalette[5], smoothstep(0.032, 0.026, d) * (0.35 + 0.65 * uLightLevel));
  } else {
    // ---- subsurface ----
    // Depth in world units, for fog and caustic attenuation.
    float depth = below * uWorldHeight;

    // Refraction: offset the scene lookup by the surface normal, strongest just
    // under the surface where the ray path through the interface is longest.
    float nearSurface = exp(-below * 12.0);
    vec2 offset = vec2(slope * REFRACT_STRENGTH * nearSurface, 0.0);
    vec4 scene = texture(uTexture, clamp(vTextureCoord + offset, 0.0, 1.0));

    // Water body colour ramps on depth in metres, not on screen fraction, so
    // the flat looks the same depth on a phone and on a tablet.
    vec3 water = mix(uPalette[2], uPalette[1], smoothstep(0.0, 1.6, depth));
    water = mix(water, uPalette[0], smoothstep(1.8, 4.2, depth));

#if CAUSTICS
    // Two scrolling voronoi layers, attenuated with depth.
    vec2 cp = vec2(vUV.x * 9.0, below * 5.0);
    float c1 = 1.0 - voronoi(cp + vec2(uTime * 0.21, uTime * 0.06));
    float c2 = 1.0 - voronoi(cp * 1.7 - vec2(uTime * 0.13, uTime * 0.04));
    float caust = pow(clamp(c1 * c2, 0.0, 1.0), 3.2);
    float causticFade = exp(-depth * 0.42) * uLightLevel;
    water = mix(water, uPalette[3], caust * causticFade * 0.55);
#endif

    // Composite the scene into the water, fogging it out with depth. The
    // coefficient is deliberately gentle: this is a screen print of flat colour
    // separations, and heavy fog turns every separation into the same mud.
    float visibility = exp(-depth * 0.22);
    col = mix(water, mix(water, scene.rgb, visibility), scene.a);

    // Glare (§8.2): a broad lobe that genuinely costs the player visibility.
    float glareLobe = exp(-pow((vUV.x - (0.5 + sin(uLightAngle) * 0.30)) * 1.9, 2.0));
    float glareHere = uGlare * glareLobe * exp(-below * 2.1);
    col = mix(col, uPalette[4], clamp(glareHere, 0.0, 0.88));

    // Specular sparkle off wave faces, only right at the surface.
    float spec = smoothstep(0.55, 1.0, crest) * nearSurface * uLightLevel;
    col = mix(col, uPalette[5], spec * 0.30);
  }

  // Foam sits across the interface, and reads as flat paper white.
  float foamBand = exp(-abs(below) * 90.0);
  col = mix(col, uPalette[5], clamp(foam, 0.0, 1.0) * foamBand * 0.92);

  // Hard waterline: a printed separation, one pixel, no soft gradient.
  float edge = smoothstep(uPixelHeight * 1.6, 0.0, abs(below));
  col = mix(col, uPalette[0], edge * 0.55);

  fragColor = vec4(toSRGB(col), 1.0);
}
