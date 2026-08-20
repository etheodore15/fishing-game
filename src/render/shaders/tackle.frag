#version 300 es
precision highp float;

/**
 * Rod and line.
 *
 * aShade carries tension for the line (§8.3: the colour shifts toward
 * palette[5] as tension rises) and a flat value for the rod blank. Output is
 * sRGB-encoded: this layer draws over the finished water, not into the
 * refraction target.
 */

in float vShade;
out vec4 fragColor;

uniform vec3 uPalette[6];
uniform float uAlpha;

vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec3 col = mix(uPalette[0], uPalette[5], clamp(vShade, 0.0, 1.0));
  fragColor = vec4(toSRGB(col), uAlpha);
}
