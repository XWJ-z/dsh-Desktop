'use strict';

/**
 * ESLint flat config（优化方案 2026-08-16 阶段六）。
 * - 基于 eslint:recommended，仅启用风格规则（warn，不阻塞）。
 * - no-undef 关闭：项目为 Electron 主进程/渲染进程混合环境，
 *   window/document 等由环境提供，逐个声明 globals 维护成本高；
 *   后续如需严格化可引入 eslint-plugin-n / globals 包细化。
 */

const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'resources/**',
      '.electron-cache/**',
      '.npm-cache/**',
      '.builder-cache/**',
      'scripts/_verify-*.js',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      'no-undef': 'off', // Electron 混合环境，见文件头注释
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }], // 项目大量 `catch { /* ignore */ }`
      'no-control-regex': 'off',
      quotes: ['warn', 'single'],
      semi: ['warn', 'always'],
      'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],
      'no-trailing-spaces': 'warn',
    },
  },
];
