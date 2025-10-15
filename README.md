# Spotify Release Bot

A serverless Next.js application with TypeScript, optimized for Vercel deployment.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Run the development server:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API Routes

- `/api/hello` - Example serverless function

## Deployment

This project is configured for easy deployment on Vercel:

1. Push your code to a Git repository
2. Import your repository to Vercel
3. Deploy automatically

## Project Structure

```
├── pages/
│   ├── api/          # Serverless API functions
│   └── index.tsx     # Main page
├── public/           # Static files
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── next.config.js    # Next.js configuration
└── vercel.json       # Vercel deployment configuration
```

## Features

- ✅ Next.js 14 with TypeScript
- ✅ Serverless API functions
- ✅ Vercel deployment ready
- ✅ ESLint configuration
- ✅ Optimized for performance
