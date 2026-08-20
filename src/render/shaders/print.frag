#version 300 es
precision highp float;
//__DEFINES__

/**
 * Print treatment (§5.3).
 *
 * Halftone on midtones only, static paper grain, and a one-pixel channel
 * misregistration. The grain is deliberately NOT animated — animated grain
 * reads as video noise and is nauseating on a phone held close to the face.
 *
 * MISREG is compiled out on mid tier and the whole filter is skipped on low.
 */

#ifndef MISREG
#define MISREG 1
#endif

in vec2 vTextureCoord;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTexture;
// Pixi's filter globals. uInputClamp is the valid sample region of the input
// texture — without it the misregistration offset reads past the edge on the
// top and left rows and returns a missing channel, which prints as a bright
// fringe along two sides of the screen.
uniform vec4 uInputClamp;
uniform vec2 uResolution;
uniform float uHalftone;   // opacity of the dot screen
uniform float uGrain;      // opacity of the paper grain
uniform float uMisreg;     // channel offset in pixels

const float DOT_PITCH = 3.4;   // px between dot centres at 1080p

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

/** One rotated dot screen. Returns 1 inside a dot, 0 outside. */
float screenDot(vec2 px, float angle, float coverage) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 r = vec2(px.x * c - px.y * s, px.x * s + px.y * c) / DOT_PITCH;
  vec2 cell = fract(r) - 0.5;
  // Dot radius grows with ink coverage, as a real screen does.
  float radius = sqrt(coverage) * 0.62;
  return smoothstep(radius, radius - 0.18, length(cell));
}

void main() {
  vec2 px = vUV * uResolution;
  vec3 col;

#if MISREG
  // Misregistration is the signature print tell: shift one channel only.
  // The shift is horizontal only. A vertical component samples past the top row
  // of the input on the first scanline whatever the clamp says, and prints as a
  // one-pixel yellow rule across the top of the screen — and a press
  // misregistration reads as a sideways shift regardless.
  vec2 off = vec2(uMisreg / uResolution.x, 0.0);
  col.r = texture(uTexture, clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw)).r;
  col.g = texture(uTexture, vTextureCoord).g;
  col.b = texture(uTexture, clamp(vTextureCoord - off * 0.35, uInputClamp.xy, uInputClamp.zw)).b;
#else
  col = texture(uTexture, vTextureCoord).rgb;
#endif

  // Two screens at the classic separation angles, applied to midtones only:
  // a halftone in the deep shadows or the paper whites just looks like dirt.
  float l = luma(col);
  float midtone = 1.0 - abs(l - 0.5) * 2.0;
  midtone = midtone * midtone;

  float coverage = 1.0 - l;
  float d1 = screenDot(px, 0.2618, coverage);   // 15 degrees
  float d2 = screenDot(px, 1.3090, coverage);   // 75 degrees
  float ink = max(d1, d2 * 0.7);
  col = mix(col, col * (1.0 - 0.55 * ink), uHalftone * midtone);

  // Static paper grain: a function of pixel position and nothing else.
  float g = hash(floor(px)) - 0.5;
  col += g * uGrain;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
