#!/usr/bin/env node
import chalk from 'chalk';
import boxen from 'boxen';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync } from 'fs';

// Load JSON data
const uiData = JSON.parse(readFileSync(new URL('../../data/ui.json', import.meta.url), 'utf-8'));
const implData = JSON.parse(readFileSync(new URL('../../data/impl.json', import.meta.url), 'utf-8'));
const shadersData = JSON.parse(readFileSync(new URL('../../data/shaders.json', import.meta.url), 'utf-8'));

// Default config
const defaultConfig = {
  pipeline: 'forward',
  shader: 'basicRT',
  materials: {
    diffuse: { color: [0.8, 0.2, 0.2], roughness: 0.9 },
    specular: { color: [1.0, 1.0, 1.0], roughness: 0.1, metallic: 0.9 },
    glass: { ior: 1.5, transmission: 0.9 },
    emissive: { color: [1.0, 0.8, 0.2], intensity: 2.0 }
  },
  lighting: {
    type: 'point',
    position: [3.0, 4.0, 2.0],
    color: [1.0, 1.0, 1.0],
    intensity: 1.0,
    shadows: true
  },
  postProcessing: {
    toneMapping: 'aces',
    exposure: 1.0,
    bloom: { enabled: false, intensity: 0.3 }
  },
  rayTracing: {
    maxBounces: 8,
    samplesPerPixel: 1,
    denoising: false
  }
};

let config = { ...defaultConfig };
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((r) => rl.question(chalk.cyan(q), r));
const clear = () => console.clear();

const showMainMenu = () => {
  clear();
  console.log(boxen(
    chalk.bold.cyan(uiData.app.title) + '\n' +
    chalk.gray(uiData.app.subtitle),
    { padding: 1, borderColor: 'cyan', margin: 1 }
  ));
  
  console.log(boxen(
    chalk.bold('Current Settings:') + '\n' +
    chalk.yellow('Pipeline: ') + config.pipeline + '\n' +
    chalk.yellow('Shader: ') + config.shader + '\n' +
    chalk.yellow('Lighting: ') + config.lighting.type + '\n' +
    chalk.yellow('Bounces: ') + config.rayTracing.maxBounces,
    { padding: 1, borderColor: 'yellow', margin: 1 }
  ));
  
  console.log(chalk.bold('\nMenu:'));
  Object.entries(uiData.menu).forEach(([key, label]) => {
    const colors = {
      pipeline: 'cyan', shader: 'green', materials: 'yellow',
      lighting: 'magenta', postProcessing: 'blue', rayTracing: 'red',
      save: 'white', load: 'white', quit: 'gray'
    };
    console.log(chalk[colors[key] || 'white'](`  [${key.charAt(0).toUpperCase()}] ${label}`));
  });
};

const showShaderMenu = async () => {
  clear();
  console.log(chalk.bold.green(uiData.menu.shader + '\n'));
  
  Object.entries(shadersData.categories).forEach(([catKey, cat]) => {
    console.log(chalk.bold.yellow(`\n${uiData.categories[catKey] || cat.name}:`));
    cat.shaders.forEach(shaderName => {
      const marker = config.shader === shaderName ? chalk.green('●') : chalk.gray('○');
      console.log(`  ${marker} ${uiData.shaders[shaderName] || shaderName}`);
    });
  });
  
  const choice = await prompt('\nSelect shader: ');
  const found = Object.keys(uiData.shaders).find(k => 
    k === choice || uiData.shaders[k].toLowerCase().includes(choice.toLowerCase())
  );
  if (found && implData[found]) config.shader = found;
};

const showMaterialMenu = async () => {
  clear();
  console.log(chalk.bold.yellow(uiData.menu.materials + '\n'));
  
  Object.entries(config.materials).forEach(([name, mat]) => {
    const matData = uiData.materials[name] || {};
    console.log(boxen(
      chalk.bold(matData.name || name.toUpperCase()) + '\n' +
      (mat.color ? chalk.gray('Color: ') + `[${mat.color.map(v => v.toFixed(2)).join(', ')}]` : '') +
      (mat.roughness !== undefined ? '\n' + chalk.gray('Roughness: ') + mat.roughness.toFixed(2) : '') +
      (mat.metallic !== undefined ? '\n' + chalk.gray('Metallic: ') + mat.metallic.toFixed(2) : '') +
      (mat.ior !== undefined ? '\n' + chalk.gray('IOR: ') + mat.ior.toFixed(2) : '') +
      (mat.intensity !== undefined ? '\n' + chalk.gray('Intensity: ') + mat.intensity.toFixed(2) : ''),
      { padding: 1, borderColor: 'gray', margin: 1 }
    ));
  });
  
  await prompt('\n' + uiData.messages.pressEnter);
};

const showLightingMenu = async () => {
  clear();
  console.log(chalk.bold.magenta(uiData.menu.lighting + '\n'));
  
  console.log(boxen(
    chalk.bold('Light Settings') + '\n' +
    chalk.gray('Type: ') + config.lighting.type + '\n' +
    chalk.gray('Position: ') + `[${config.lighting.position.map(v => v.toFixed(1)).join(', ')}]` + '\n' +
    chalk.gray('Color: ') + `[${config.lighting.color.map(v => v.toFixed(2)).join(', ')}]` + '\n' +
    chalk.gray('Intensity: ') + config.lighting.intensity.toFixed(2) + '\n' +
    chalk.gray('Shadows: ') + (config.lighting.shadows ? chalk.green('ON') : chalk.red('OFF')),
    { padding: 1, borderColor: 'magenta', margin: 1 }
  ));
  
  await prompt('\n' + uiData.messages.pressEnter);
};

const showPostProcessingMenu = async () => {
  clear();
  console.log(chalk.bold.blue(uiData.menu.postProcessing + '\n'));
  
  console.log(boxen(
    chalk.bold('Tone Mapping') + '\n' +
    chalk.gray('Type: ') + config.postProcessing.toneMapping + '\n' +
    chalk.gray('Exposure: ') + config.postProcessing.exposure.toFixed(2),
    { padding: 1, borderColor: 'blue', margin: 1 }
  ));
  
  await prompt('\n' + uiData.messages.pressEnter);
};

const showRayTracingMenu = async () => {
  clear();
  console.log(chalk.bold.red(uiData.menu.rayTracing + '\n'));
  
  console.log(boxen(
    chalk.bold('Settings') + '\n' +
    chalk.gray('Max Bounces: ') + config.rayTracing.maxBounces + '\n' +
    chalk.gray('Samples Per Pixel: ') + config.rayTracing.samplesPerPixel + '\n' +
    chalk.gray('Denoising: ') + (config.rayTracing.denoising ? chalk.green('ON') : chalk.red('OFF')),
    { padding: 1, borderColor: 'red', margin: 1 }
  ));
  
  await prompt('\n' + uiData.messages.pressEnter);
};

const saveConfig = async () => {
  const filename = await prompt('Filename (default: pipeline-config.json): ') || 'pipeline-config.json';
  writeFileSync(filename, JSON.stringify(config, null, 2));
  console.log(chalk.green(`\n✓ ${uiData.messages.saved} ${filename}`));
  await prompt('\n' + uiData.messages.pressEnter);
};

const loadConfig = async () => {
  const filename = await prompt('Filename: ');
  try {
    const data = JSON.parse(readFileSync(filename, 'utf-8'));
    config = { ...defaultConfig, ...data };
    console.log(chalk.green('\n✓ ' + uiData.messages.loaded));
  } catch (e) {
    console.log(chalk.red('\n✗ ' + uiData.messages.error));
  }
  await prompt('\n' + uiData.messages.pressEnter);
};

const main = async () => {
  let running = true;
  while (running) {
    showMainMenu();
    const choice = await prompt('\nSelect: ');
    
    switch (choice.toLowerCase()) {
      case 'p': case 'pipeline':
        clear();
        console.log(chalk.cyan('Pipeline: ' + Object.values(uiData.pipelines).join(' / ')));
        const p = await prompt('Set pipeline: ');
        if (Object.keys(uiData.pipelines).includes(p)) config.pipeline = p;
        break;
      case 's': case 'shader': await showShaderMenu(); break;
      case 'm': case 'materials': await showMaterialMenu(); break;
      case 'l': case 'lighting': await showLightingMenu(); break;
      case 'post': case 'postProcessing': await showPostProcessingMenu(); break;
      case 'r': case 'rayTracing': await showRayTracingMenu(); break;
      case 'save': await saveConfig(); break;
      case 'load': await loadConfig(); break;
      case 'q': case 'quit': running = false; break;
    }
  }
  rl.close();
  console.log(chalk.cyan('\nGoodbye!'));
  process.exit(0);
};

main();
