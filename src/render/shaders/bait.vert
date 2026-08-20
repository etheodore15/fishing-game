#version 300 es
precision highp float;

/** Bait marks (§8.5): flat dashes, not sprites. */

in vec2 aPosition;
in float aFlash;

out float vFlash;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vFlash = aFlash;
}
