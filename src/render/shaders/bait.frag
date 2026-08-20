#version 300 es
precision highp float;

/**
 * A bait mark is one flat tone. The only variation is the flash — a panicked
 * fish turning on its side catches the light, which is exactly the signal a
 * player reads a bust-up from at distance.
 *
 * Linear out: this draws into the refraction target.
 */

in float vFlash;
out vec4 fragColor;

uniform vec3 uPalette[6];
uniform float uAlpha;

void main() {
  vec3 col = mix(uPalette[0], uPalette[5], clamp(vFlash, 0.0, 1.0));
  fragColor = vec4(col, uAlpha);
}
