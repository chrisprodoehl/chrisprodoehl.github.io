    // lots of code based on this tutorial: http://jamie-wong.com/2016/07/15/ray-marching-signed-distance-functions/

#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec3 u_camera;
uniform float u_time;

int MAX_MARCHING_STEPS = 256;
float MIN_DIST = 0.0;
float MAX_DIST = 50.0;
float EPSILON = 0.001;

// SOME VARIOUS NOISE FUNCTIONS

// random function
float random (in vec2 st) {
    return fract(sin(dot(st, vec2(24,80.233))) * 20.0);
}

//noise function
float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Four corners in 2D of a tile
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// fbn noise
#define NUM_OCTAVES 8

float fbm ( in vec2 st ) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0 + (u_time * 0.3));
    // Rotate to reduce axial bias
    mat2 rot = mat2(cos(0.5), sin(0.5),
                    -sin(0.5), cos(0.50));
    for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(st);
        st = rot * st * 2.0 + shift;
        a *= 0.245;
    }
    return v;
}

// sphere SDF
float sphereSDF( vec3 p ) {
    float noise = fbm(p.xz);
    return length(p) - 3.0;
}

float torusSDF( vec3 samplePoint, vec2 t ) {
    vec2 q = vec2(length(samplePoint.xz)-t.x, samplePoint.y);
    return length(q) - t.y;
}

float terrainSDF ( vec3 p ) {
    //float terrainNoise = noise(p.xy);
    float terrainNoise = fbm(p.xy + fbm(p.xz)); // p.zy also looks good for the first
    return 0.4 - 0.4*sin(p.y*0.4 - cos(p.y*0.4)) + (terrainNoise * (0.4 + u_time));
    //return sin(p.z)*0.1 + cos(p.x)*0.1;
}

float terrain2DSDF ( vec2 p ) {
    //float terrainNoise = noise(p.xy);
    float terrainNoise = fbm(p.xy + fbm(p.yx)); // p.zy also looks good for the first
    return 0.4 - 0.44*sin(p.y*0.4 - cos(p.y*0.4)) + (terrainNoise * 0.4);
    //return sin(p.z)*0.1 + cos(p.x)*0.1;
}

float opRepSphere( vec3 p, vec3 c) {
    vec3 q = mod(p + 0.5 * c, c) - 0.5 * c;
    return sphereSDF(q);
}

// scene SDF -- computes fields for the whole scene, maybe more than one shape!
float sceneSDF( vec3 p ) {
    //p.y = 0.0;
    vec3 spacing = vec3(6.5); // spacing is for the repetition
    //return opRepSphere(samplePoint, spacing);
    return terrainSDF(p);
    //return sphereSDF(p);


    //return torusSDF(samplePoint, vec2(1.0, 0.5));
}

// raymarching v1
float shortestDistToSurface( vec3 eye, vec3 marchingDir, float start, float end ) {
    float depth = start;
    for (int i = 0; i < MAX_MARCHING_STEPS; i++) {
        float dist = sceneSDF(eye + depth * marchingDir);
        if (dist < EPSILON) {
            return depth;
        }
        depth += dist;
        if (depth >= end) {
          return end;
        }
    }
    return end;
}

float terrainIntersect( vec3 eye, vec3 marchingDir, float tmin, float tmax ) {
    float t = tmin;
    for ( int i = 0; i < MAX_MARCHING_STEPS; i++ ) {
      vec3 pos =  eye + t * marchingDir;
      float h = pos.y - terrain2DSDF(pos.xz);
      if( (abs(h) < 0.002*t) || t>tmax ) {
          break;
          }
      t += 0.4*h;
    }
    return t;
}

// getting the ray direction
vec3 rayDir( float FOV, vec2 resolution, vec2 fragcoord ) {
    vec2 xy = fragcoord - resolution / 2.0;
    float z = resolution.y  * 0.75 / tan(radians(FOV) / 2.0);
    return normalize(vec3(xy, -z));
}

// make some normals from the gradient -- "finite differences"
vec3 estimateNormal( vec3 pos) {
    return normalize( vec3 (
      sceneSDF(vec3(pos.x + EPSILON, pos.y, pos.z)) - sceneSDF(vec3(pos.x - EPSILON, pos.y, pos.z)),
      sceneSDF(vec3(pos.x, pos.y + EPSILON, pos.z)) - sceneSDF(vec3(pos.x, pos.y - EPSILON, pos.z)),
      sceneSDF(vec3(pos.x, pos.y, pos.z + EPSILON)) - sceneSDF(vec3(pos.x, pos.y, pos.z - EPSILON))
      ));
}

// phong lighting contribution
vec3 phongContribForLight( vec3 kd, vec3 ks, float alpha, vec3 p, vec3 eye, vec3 lightPos, vec3 lightIntensity) {
  vec3 N = estimateNormal(p);
  vec3 L = normalize(lightPos - p);
  vec3 V = normalize(eye - p);
  vec3 R = normalize(reflect(-L, N));

  float dotLN = clamp(dot(L, N), 0.0, 1.0);
  float dotRV = dot(R, V);

  if (dotLN < 0.0) {
    // light not visible from this samplePoint
    return vec3(0.0);
  }

  if (dotRV < 0.0) {
    return lightIntensity * (kd * dotLN);
  }
  return lightIntensity * (kd * dotLN + ks * pow(dotRV, alpha));
}

// lighting!
vec3 phongIllumination( vec3 ka, vec3 kd, vec3 ks, float alpha, vec3 p, vec3 eye) {
  const vec3 ambientLight = 0.75 * vec3(0.82, 0.2, 0.67);
  vec3 color = ambientLight * ka;

  vec3 light1Pos = vec3(-12.0, 20.0, 12.0);
  //vec3 light1Pos = vec3(4.0, 10.0, 4.0);
  vec3 light1Intensity = vec3(0.75, 0.75, 0.75);

  color += phongContribForLight(kd, ks, alpha, p, eye, light1Pos, light1Intensity);

  return color;
}

// view matrix for camera rotations
mat4 viewMatrix( vec3 eye, vec3 target, vec3 up) {
    vec3 f = normalize(target - eye);
    vec3 s = normalize(cross(f, up));
    vec3 u = cross(s, f);
    return mat4(
        vec4(s, 0.0),
        vec4(u, 0.0),
        vec4(-f, 0.0),
        vec4(0.0, 0.0, 0.0, 1.0)
    );
}

// MAIN IMAGE FUNCTION
void main()
{

    vec4 color = vec4(1.0);
    vec2 res = u_resolution;
    vec2 fragCoord = gl_FragCoord.xy;
    vec3 eyeStationary = vec3(0.0);
    vec3 eye = vec3(1.0 + u_time * 0.05, 3.0, 1.0); //0.0 - u_time * 2.0);
    // the ray direction, here moved into world space, will be the marching direction
    vec3 rayDir = rayDir(60.0, res.xy, fragCoord);
    mat4 viewToWorld = viewMatrix(eye, vec3(-1.0, -5.0, 0.0) + eye, vec3(0.0, 1.0, 0.0));
    vec3 worldDir = (viewToWorld * vec4(rayDir, 0.0)).xyz;
    //worldDir.y = 0.0;

    //float dist = shortestDistToSurface(eye, worldDir, MIN_DIST, MAX_DIST); // 3D input
    float dist = terrainIntersect(eye, worldDir, MIN_DIST, MAX_DIST);
    /*
    if you hold eye stationary, normals stay the same, but y position is actually changing
    so it looks water kind of--surface deformed by waves. I think, right now I can't
    tell why it looks like moving water.

    figured it out: the surfacePos was still using rayDir, not worldDir
    i think did kind of like the other effect better
    */
    vec3 surfacePos = eye + dist * worldDir;
    vec3 N = estimateNormal(surfacePos);

    vec3 pct = vec3(surfacePos.y);
    pct.r = smoothstep(0.0, 1.0, surfacePos.y);
    vec3 colorA = vec3(0.4, 0.4, 0.4);
    vec3 colorB = vec3(1.0, 0.7, 1.0);
    //vec3 baseCol = mix(colorA, colorB, pct);
    vec3 baseCol = vec3(0.3);
    vec4 envCol = vec4(0.2);

    vec3 Ka = vec3(0.13, 0.15, 0.12); // Ka is ambient color
    vec3 Kd = baseCol; // Kd is diffuse color
    vec3 Ks = vec3(0.18, 0.8, 0.8);
    float shininess = 5.0;
    vec3 phongColor = phongIllumination(Ka, Kd, Ks, shininess, surfacePos, eye);

    if (dist > (MAX_DIST - EPSILON)) {
      // the ray didn't hit the shape
      color = envCol;
      //return;
    } else {
      color = vec4(phongColor, 1.0);
    }

    //color = vec4(1.0, 0.0, 0.0, 1.0);

    gl_FragColor = color;
}
