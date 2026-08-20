#version 300 es
precision highp float;

/**
 * One shader for every emitter (§8.6). A particle is a flat mark in a palette
 * colour — there is no soft sprite anywhere, because a screen print has no
 * soft edges.
 *
 * uEncode is 1 for the above-water field, which draws over the finished water,
 * and 0 for the subsurface field, which draws into the refraction target and
 * must stay linear.
 */

in float vSlot;
in float vAlpha;
out vec4 fragColor;

uniform vec3 uPalette[6];
uniform float uEncode;

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec3 col = uPalette[int(vSlot + 0.5)];
  fragColor = vec4(mix(col, toSRGB(col), uEncode), vAlpha);
}
