#version 300 es
precision highp float;

/**
 * Shared full-screen vertex stage for every custom pass.
 *
 * Matches PixiJS's filter convention so the FilterSystem drives these passes:
 * vTextureCoord samples the input texture through the current output frame,
 * vUV is plain 0-1 screen space for the passes that need to reason about the
 * waterline and the light position.
 */

in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vUV;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  gl_Position = vec4(
    position.x * (2.0 / uOutputTexture.x) - 1.0,
    position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z,
    0.0, 1.0
  );
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vUV = aPosition;
}
