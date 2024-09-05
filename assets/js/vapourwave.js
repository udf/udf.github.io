import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";

async function main() {
  const canvas = document.querySelector('canvas.webgl');

  // Scene
  const scene = new THREE.Scene();

  // Fog
  const fog = new THREE.Fog("#1f2937", 1, 2.5);
  scene.fog = fog;

  // Objects
  const planeSize = { w: 24, h: 48 };
  const planeSizeUnits = { w: 1, h: 2 };

  // TODO: generate noise map
  // const noiseData = new Uint8Array(planeSize.w * planeSize.h);
  // for (let i = 0; i < noiseData.length; i++) {
  //   const v = Math.floor(Math.random() * 255);
  //   noiseData[i] = v;
  // }
  // const noiseTexture = new THREE.DataTexture({
  //   data: noiseData,
  //   width: planeSize.w,
  //   height: planeSize.h,
  //   format: THREE.LuminanceFormat
  // });
  // noiseTexture.needsUpdate = true;

  const textureLoader = new THREE.TextureLoader();
  const noiseTexture = await textureLoader.loadAsync('/displacement.png');

  const geometry = new THREE.PlaneGeometry(planeSizeUnits.w, planeSizeUnits.h, planeSize.w, planeSize.h);
  let uniforms = {
    segU: { value: planeSize.w },
    segV: { value: planeSize.h },
    isWire: { value: false },
    wireWidthFactor: { value: 2 },
    wireColor: { value: new THREE.Color(0xcccccc) },
    dmap: { value: noiseTexture },
    scroll: { value: 0.0 }
  }
  const material = new THREE.MeshStandardMaterial({
    metalness: 1,
    roughness: 0.3,
    onBeforeCompile: shader => {
      shader.uniforms.segU = uniforms.segU;
      shader.uniforms.segV = uniforms.segV;
      shader.uniforms.wireColor = uniforms.wireColor;
      shader.uniforms.isWire = uniforms.isWire;
      shader.uniforms.wireWidthFactor = uniforms.wireWidthFactor;
      shader.uniforms.dmap = uniforms.dmap;
      shader.uniforms.scroll = uniforms.scroll;
      shader.fragmentShader = `
        uniform float segU;
        uniform float segV;
        uniform vec3 wireColor;
        uniform float isWire;
        uniform float wireWidthFactor;
  
        ${shader.fragmentShader}
      `.replace(
        `#include <dithering_fragment>`,
        `
          #include <dithering_fragment>
  
          // http://madebyevan.com/shaders/grid/
          vec2 coord = vUv * vec2(segU, segV);
  
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = min(grid.x, grid.y) / wireWidthFactor;
          line = 1.0 - min(line, 1.0);
          
          if (isWire > 0.5 && line < 0.5) discard;
          if (isWire > 0.5) gl_FragColor = vec4(0);
          float fade = 1.0 - vUv.y;
          gl_FragColor = mix(gl_FragColor, vec4(wireColor, 1.0), line * fade * fade);
        `
      );
      console.log(shader.fragmentShader);

      shader.vertexShader = `
        uniform sampler2D dmap;
        uniform float scroll;
        ${shader.vertexShader}
      `.replace(
        `#include <begin_vertex>`,
        `
          #include <begin_vertex>
          // offset the plane textures in the same increments as scrolling moves the plane
          // but also shift the sampling position by 1 square after every increment
          float offset = floor(scroll * ${planeSize.h / planeSizeUnits.h}.0) / ${planeSize.h}.0;
          transformed.z += texture(dmap, vec2(uv.x, fract(uv.y + offset))).r * 0.4;
        `
      );
      console.log(shader.vertexShader)
    },
  });
  material.defines = { 'USE_UV': '' };

  const plane = new THREE.Mesh(geometry, material);

  // Here we position our plane flat in front of the camera
  plane.rotation.x = -Math.PI * 0.5;
  plane.position.y = 0.0;
  plane.position.z = 0.0;
  scene.add(plane);

  // Light
  // Ambient Light
  const ambientLight = new THREE.AmbientLight("#ffffff", 10);
  scene.add(ambientLight);

  // Right Spotlight aiming to the left
  const spotlight = new THREE.SpotLight("#5bcffa", 20, 25, Math.PI * 0.1, 0.25);
  spotlight.position.set(0.5, 0.75, 2.2);
  // Target the spotlight to a specific point to the left of the scene
  spotlight.target.position.x = -0.25;
  spotlight.target.position.y = 0.25;
  spotlight.target.position.z = 0.25;
  scene.add(spotlight);
  scene.add(spotlight.target);

  // Left Spotlight aiming to the right
  const spotlight2 = new THREE.SpotLight("#f5abb9", 20, 25, Math.PI * 0.1, 0.25);
  spotlight2.position.set(-0.5, 0.75, 2.2);
  // Target the spotlight to a specific point to the right side of the scene
  spotlight2.target.position.x = 0.25;
  spotlight2.target.position.y = 0.25;
  spotlight2.target.position.z = 0.25;
  scene.add(spotlight2);
  scene.add(spotlight2.target);

  // Sizes
  const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // Camera
  const camera = new THREE.PerspectiveCamera(
    // field of view
    75,
    // aspect ratio
    sizes.width / sizes.height,
    // near plane: it's low since we want our mesh to be visible even from very close
    0.01,
    // far plane: how far we're rendering
    20
  );

  // Position the camera a bit higher on the y axis and a bit further back from the center
  camera.position.x = 0;
  camera.position.y = 0.1;
  camera.position.z = 1.1;

  // Controls
  // These are custom controls I like using for dev: we can drag/rotate the scene easily
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas
  });
  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1f2937, 0);

  // Post Processing
  const effectComposer = new EffectComposer(renderer);
  effectComposer.setSize(sizes.width, sizes.height);
  effectComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const renderPass = new RenderPass(scene, camera);
  effectComposer.addPass(renderPass);

  const rgbShiftPass = new ShaderPass(RGBShiftShader);
  rgbShiftPass.uniforms["amount"].value = 0.0015;

  effectComposer.addPass(rgbShiftPass);

  const gammaCorrectionPass = new ShaderPass(GammaCorrectionShader);
  effectComposer.addPass(gammaCorrectionPass);

  // Event listener to handle screen resize
  window.addEventListener('resize', () => {
    // Update sizes
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;

    // Update camera's aspect ratio and projection matrix
    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    // Update renderer
    renderer.setSize(sizes.width, sizes.height);
    // Note: We set the pixel ratio of the renderer to at most 2
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    effectComposer.render();
  });

  // const animate = () => {
  //   effectComposer.render();
  // };
  // renderer.setAnimationLoop(animate);

  const setupColours = () => {
    const darkMode = document.documentElement.classList.contains('dark');
    fog.color = new THREE.Color(darkMode ? 0x1f2937 : 0xffffff);
    uniforms.wireColor.value = new THREE.Color(darkMode ? 0x9e9e9e : 0xffffff);
    material.roughness = darkMode ? 0.30 : 0.75;
    const article = document.querySelector('article');
    if (article) {
      article.style.color = darkMode ? '#ffffff' : '#000000';
      article.style.textShadow = `0 0 0.5em ${darkMode ? '#000000' : '#ffffff'}`;
    }
  };

  setupColours();
  effectComposer.render();

  const darkmodeToggle = document.querySelector('.toggle-dark-mode');
  if (darkmodeToggle) {
    darkmodeToggle.addEventListener('click', () => {
      setupColours();
      effectComposer.render();
    });
  }

  document.body.onscroll = () => {
    uniforms.scroll.value = (
      (document.documentElement.scrollTop || document.body.scrollTop) / (
        (document.documentElement.scrollHeight || document.body.scrollHeight)
        - document.documentElement.clientHeight
      )
    );
    // move the plane forward by 1 unit when scrolled all the way down
    const squaresPerUnit = planeSize.h / planeSizeUnits.h;
    plane.position.z = ((uniforms.scroll.value * squaresPerUnit) % 1.0) / squaresPerUnit;
    effectComposer.render();
  };
}

main();