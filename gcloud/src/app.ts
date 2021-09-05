'use strict';

import express from 'express';
import cors from 'cors';
import { createApiRoutes } from './api';
import { registerForEvents } from './events';

import * as admin from 'firebase-admin';
const serviceAccount = require('../cert/auto-shark-firebase-adminsdk-wfxle-31eb7a6ea3.json');

async function startServer() {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  const firestore = admin.firestore();

  const app = express();
  app.use(cors());

  app.get('/_ah/warmup', (req, res) => {
    // Handle your warmup logic. Initiate db connection, etc.
  });

  app.get('/', (req, res) => {
    res.status(200).send('sharkapi').end();
  });
  createApiRoutes(app);

  // error handler
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    res
      .status(500)
      .send('<pre>error: ' + err.message + '\n' + err.stack + '</pre>');
  });

  // Start the server
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    registerForEvents();

    console.info(`App listening on port ${PORT}`);
    console.info('Press Ctrl+C to quit.');
  });

  setInterval(function () {
    console.log('ping');
  }, 1000 * 60);

  return app;
}

module.exports = startServer;

startServer();
