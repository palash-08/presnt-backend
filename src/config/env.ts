import dotenv from 'dotenv';
dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
};

// Validate critical env vars at startup
const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
for (const key of required) {
  if (!env[key] || env[key] === 'dev-secret-change-me') {
    console.warn(`⚠️  Warning: ${key} is not set or using default value.`);
  }
}
