#version 300 es
precision highp float;

/**
 * Vertex stage for the parametric fish rig (§8.1).
 *
 * The rig writes world metres; the mesh sits inside a world-space container, so
 * the standard PixiJS mesh transform chain does the rest.
 */

in vec2 aPosition;
in vec2 aUV;
in float aRole;
in float aFlank;

out vec2 vUV;
out float vRole;
out float vFlank;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vRole = aRole;
  vFlank = aFlank;
}
