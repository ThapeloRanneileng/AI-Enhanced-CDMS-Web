import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AppConfig } from './app.config';
import * as session from 'express-session';
import * as pgSession from 'connect-pg-simple';
import { Pool } from 'pg';
import * as express from 'express';
import * as helmet from 'helmet';
import * as fs from 'fs';

async function bootstrap() {
  // TLS: use HTTPS when cert paths are provided, otherwise HTTP (keeps dev working)
  const httpsOptions =
    process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH
      ? {
          key: fs.readFileSync(process.env.TLS_KEY_PATH),
          cert: fs.readFileSync(process.env.TLS_CERT_PATH),
        }
      : undefined;

  const app = await NestFactory.create(AppModule, { httpsOptions });

  // Security headers: X-Frame-Options, X-Content-Type-Options, HSTS, CSP, etc.
  app.use((helmet as any).default ? (helmet as any).default() : (helmet as any)());

  // CORS: restrict to env-configured origins in production, allow all in development
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null;

  app.enableCors({
    origin: allowedOrigins
      ? allowedOrigins
      : true,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  const PgSession = pgSession(session);
  const pgPool = new Pool({
    user: AppConfig.dbCredentials.username,
    host: AppConfig.dbCredentials.host,
    database: AppConfig.dbCredentials.database,
    password: AppConfig.dbCredentials.password,
    port: AppConfig.dbCredentials.port,
  });

  app.use(
    session({
      store: new PgSession({
        pool: pgPool,
        tableName: 'user_sessions',
        createTableIfMissing: true,
        pruneSessionInterval: 24 * 60 * 60,  // Set to 24 hours. Note this is given in seconds.
      }),
      secret: AppConfig.dbCredentials.password,
      resave: false,
      rolling: true, // Reset the session cookie expiration on every request
      saveUninitialized: false,
      cookie: {
        maxAge: 2 * 60 * 60 * 1000,  // Set to 2 hours. Note, this is given in milliseconds.
        secure: !!httpsOptions, // true when TLS is active
      },
    }),
  );

  // Increase the allowed payload request from the default 100kb to 1MB
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));

  // Set the port to listen for connections
  await app.listen(3000);
}

bootstrap();
