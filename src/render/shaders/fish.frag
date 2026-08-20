#version 300 es
precision highp float;

/**
 * Fragment stage for the fish rig (§8.1).
 *
 * Two flat tones with a hard lateral separation, a variable-weight outline, an
 * iridescence band that moves with the flank as the body wave rolls through it,
 * and markings generated from a procedural rule — never a texture.
 *
 * Output is LINEAR, because this draws into the refraction target that the
 * subsurface pass mixes in linear before its single sRGB conversion.
 */

#define MAX_MARKS 16

in vec2 vUV;
in float vRole;
in float vFlank;
out vec4 fragColor;

uniform vec3 uPalette[6];
uniform float uDorsalIdx;
uniform float uVentralIdx;
uniform float uIridescence;
/** 0 none, 1 ocelli, 2 stripes, 3 spots. */
uniform int uMarkType;
uniform int uMarkCount;
uniform float uMarkSeed;
uniform vec2 uLightDir;
uniform float uLightLevel;
uniform float uAlpha;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}

/** Rotate a colour's hue. Cheap Rodrigues rotation about the grey axis. */
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cosA = cos(a);
  return c * cosA + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cosA);
}

/**
 * Markings as a rule, not a texture. Returns ink coverage 0-1.
 * The seed is the species' own, so a flathead's ocelli are in the same place
 * on every flathead — they are a field mark, not noise.
 */
float markings(vec2 uv) {
  if (uMarkType == 0) return 0.0;

  if (uMarkType == 2) {
    // Stripes: bars across the body, denser toward the tail.
    float bars = sin(uv.x * 34.0 + uMarkSeed) * 0.5 + 0.5;
    return smoothstep(0.72, 0.9, bars) * smoothstep(0.05, 0.3, uv.x);
  }

  float ink = 0.0;
  for (int i = 0; i < MAX_MARKS; i++) {
    if (i >= uMarkCount) break;
    float fi = float(i) + uMarkSeed;
    // Spots sit along the flank, avoiding the head and the very tip.
    float cx = 0.18 + hash11(fi * 1.7) * 0.72;
    float cy = (hash11(fi * 3.1) - 0.5) * 1.35;
    float r = 0.030 + hash11(fi * 5.3) * 0.022;
    // The body is long and thin in UV, so the metric has to be too.
    vec2 d = vec2((uv.x - cx) * 2.4, uv.y - cy);
    float dist = length(d);

    if (uMarkType == 1) {
      // Ocellus: a pale centre inside a dark ring.
      float ring = smoothstep(r, r * 0.82, dist) - smoothstep(r * 0.55, r * 0.38, dist);
      ink = max(ink, clamp(ring, 0.0, 1.0));
    } else {
      ink = max(ink, smoothstep(r, r * 0.7, dist));
    }
  }
  return ink;
}

void main() {
  vec3 dorsal = uPalette[int(uDorsalIdx)];
  vec3 ventral = uPalette[int(uVentralIdx)];
  vec3 ink = uPalette[0];

  if (vRole > 0.5 && vRole < 1.5) {
    // Outline: one flat ink, hard edged. The weight variation is geometry.
    fragColor = vec4(ink, uAlpha);
    return;
  }

  // Hard lateral separation — a print has no gradient across it.
  float side = step(0.0, vUV.y);
  vec3 col = mix(dorsal, ventral, side);

  if (vRole > 1.5) {
    // Fins: the dorsal tone knocked back, so they read as a separate plate.
    col = mix(col, ink, 0.35);
    fragColor = vec4(col, uAlpha * 0.92);
    return;
  }

  // The belly is lighter still where the light actually reaches it.
  col = mix(col, uPalette[5], side * 0.12 * uLightLevel);

  // Markings, in ink, over the flat tones.
  col = mix(col, ink, markings(vUV) * 0.72);

  // Iridescence (§8.1): a band along the lateral line whose hue shifts with
  // the flank's angle to the viewer and with the light direction. The body
  // wave rolls the flank in and out, so the band travels down the fish.
  float band = exp(-pow(vUV.y * 3.4, 2.0));
  float facing = clamp(vFlank * uLightDir.x + 0.35 * uLightDir.y, -1.0, 1.0);
  float irid = uIridescence * band * smoothstep(0.05, 0.9, abs(facing)) * uLightLevel;
  col = mix(col, hueShift(uPalette[3], facing * 1.9), irid);

  // The separation line itself.
  col = mix(col, ink, exp(-abs(vUV.y) * 26.0) * 0.45);

  fragColor = vec4(col, uAlpha);
}
