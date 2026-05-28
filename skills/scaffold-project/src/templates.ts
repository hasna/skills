import type { Template } from "./types";

export const TEMPLATES: Record<Template, {
  name: string;
  description: string;
  category: string;
  defaultDeps: string[];
  defaultDevDeps: string[];
}> = {
  next: {
    name: 'Next.js 15',
    description: 'Next.js 15 App Router with React, TypeScript, and Tailwind',
    category: 'frontend',
    defaultDeps: ['next', 'react', 'react-dom'],
    defaultDevDeps: ['@types/node', '@types/react', '@types/react-dom', 'typescript'],
  },
  react: {
    name: 'React + Vite',
    description: 'Vite + React + TypeScript',
    category: 'frontend',
    defaultDeps: ['react', 'react-dom'],
    defaultDevDeps: ['@types/react', '@types/react-dom', '@vitejs/plugin-react', 'typescript', 'vite'],
  },
  vue: {
    name: 'Vue 3 + Vite',
    description: 'Vite + Vue 3 + TypeScript',
    category: 'frontend',
    defaultDeps: ['vue'],
    defaultDevDeps: ['@vitejs/plugin-vue', 'typescript', 'vite', 'vue-tsc'],
  },
  svelte: {
    name: 'SvelteKit',
    description: 'SvelteKit + TypeScript',
    category: 'frontend',
    defaultDeps: ['svelte'],
    defaultDevDeps: ['@sveltejs/adapter-auto', '@sveltejs/kit', 'typescript', 'vite'],
  },
  astro: {
    name: 'Astro',
    description: 'Astro + TypeScript',
    category: 'frontend',
    defaultDeps: ['astro'],
    defaultDevDeps: ['@astrojs/tailwind', 'typescript'],
  },
  remix: {
    name: 'Remix',
    description: 'Remix + TypeScript',
    category: 'frontend',
    defaultDeps: ['@remix-run/node', '@remix-run/react', '@remix-run/serve', 'react', 'react-dom'],
    defaultDevDeps: ['@remix-run/dev', '@types/react', '@types/react-dom', 'typescript'],
  },
  express: {
    name: 'Express.js',
    description: 'Express + TypeScript',
    category: 'backend',
    defaultDeps: ['express', 'cors', 'dotenv'],
    defaultDevDeps: ['@types/express', '@types/cors', '@types/node', 'typescript', 'tsx'],
  },
  fastapi: {
    name: 'FastAPI',
    description: 'FastAPI + Python',
    category: 'backend',
    defaultDeps: ['fastapi', 'uvicorn', 'pydantic'],
    defaultDevDeps: ['black', 'pytest'],
  },
  hono: {
    name: 'Hono',
    description: 'Hono + TypeScript (edge-ready)',
    category: 'backend',
    defaultDeps: ['hono'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  elysia: {
    name: 'Elysia',
    description: 'Elysia + Bun + TypeScript',
    category: 'backend',
    defaultDeps: ['elysia'],
    defaultDevDeps: ['bun-types'],
  },
  nestjs: {
    name: 'NestJS',
    description: 'NestJS + TypeScript',
    category: 'backend',
    defaultDeps: ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs'],
    defaultDevDeps: ['@nestjs/cli', '@types/node', 'typescript'],
  },
  t3: {
    name: 'T3 Stack',
    description: 'Next.js + tRPC + Prisma + NextAuth',
    category: 'fullstack',
    defaultDeps: ['next', 'react', 'react-dom', '@trpc/client', '@trpc/server', '@trpc/react-query', '@tanstack/react-query', 'zod'],
    defaultDevDeps: ['@types/node', '@types/react', '@types/react-dom', 'typescript'],
  },
  'nextjs-supabase': {
    name: 'Next.js + Supabase',
    description: 'Next.js + Supabase',
    category: 'fullstack',
    defaultDeps: ['next', 'react', 'react-dom', '@supabase/supabase-js'],
    defaultDevDeps: ['@types/node', '@types/react', '@types/react-dom', 'typescript'],
  },
  'remix-prisma': {
    name: 'Remix + Prisma',
    description: 'Remix + Prisma ORM',
    category: 'fullstack',
    defaultDeps: ['@remix-run/node', '@remix-run/react', '@remix-run/serve', 'react', 'react-dom', '@prisma/client'],
    defaultDevDeps: ['@remix-run/dev', '@types/react', '@types/react-dom', 'typescript', 'prisma'],
  },
  'rest-api': {
    name: 'REST API',
    description: 'REST API boilerplate',
    category: 'api',
    defaultDeps: ['express', 'cors', 'dotenv'],
    defaultDevDeps: ['@types/express', '@types/cors', '@types/node', 'typescript', 'tsx'],
  },
  graphql: {
    name: 'GraphQL API',
    description: 'GraphQL API (Apollo Server)',
    category: 'api',
    defaultDeps: ['@apollo/server', 'graphql'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  trpc: {
    name: 'tRPC API',
    description: 'tRPC API',
    category: 'api',
    defaultDeps: ['@trpc/server', 'zod'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  cli: {
    name: 'CLI Tool',
    description: 'CLI tool with Commander.js or Bun',
    category: 'other',
    defaultDeps: ['commander'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  'chrome-extension': {
    name: 'Chrome Extension',
    description: 'Chrome extension boilerplate',
    category: 'other',
    defaultDeps: [],
    defaultDevDeps: ['@types/chrome', 'typescript'],
  },
  electron: {
    name: 'Electron',
    description: 'Electron desktop app',
    category: 'other',
    defaultDeps: ['electron'],
    defaultDevDeps: ['@types/node', 'typescript'],
  },
  'react-native': {
    name: 'React Native',
    description: 'React Native mobile app',
    category: 'other',
    defaultDeps: ['react', 'react-native'],
    defaultDevDeps: ['@types/react', 'typescript'],
  },
  tauri: {
    name: 'Tauri',
    description: 'Tauri desktop app',
    category: 'other',
    defaultDeps: ['@tauri-apps/api'],
    defaultDevDeps: ['@tauri-apps/cli', 'typescript'],
  },
  monorepo: {
    name: 'Turborepo Monorepo',
    description: 'Turborepo monorepo',
    category: 'other',
    defaultDeps: [],
    defaultDevDeps: ['turbo'],
  },
};

// ============================================================================
