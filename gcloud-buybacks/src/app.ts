'use strict';

import express from 'express';
import cors from 'cors';

import * as admin from 'firebase-admin';
const serviceAccount = require('../cert/auto-shark-firebase-adminsdk-wfxle-31eb7a6ea3.json');
const lb = require('@google-cloud/logging-bunyan');
import { createBuybackRoutes } from './buybacks';

async function startServer() {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://auto-shark-default-rtdb.firebaseio.com/',
  });
  const firestore = admin.firestore();

  const { logger, mw: buybackLog } = await lb.express.middleware({
    logName: 'buybacks',
    serviceContext: {
      service: 'buybacks',
    },
  });

  const app = express();
  // Install the logging middleware. This ensures that a Bunyan-style `log`
  // function is available on the `request` object. This should be the very
  // first middleware you attach to your app.
  // app.use(defaultLog);

  app.use(cors());

  app.get('/_ah/warmup', buybackLog, (req, res) => {
    // Handle your warmup logic. Initiate db connection, etc.
    res.send('success');
  });

  app.get('/', buybackLog, (req, res) => {
    res.status(200).send('buybacks').end();
  });
  createBuybackRoutes(app, buybackLog);

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
  const PORT = process.env.PORT || 8082;
  app.listen(PORT, () => {
    logger.info(`Buybacks service listening on port ${PORT}`);
    logger.info('Press Ctrl+C to quit.');
  });

  return app;
}

module.exports = startServer;

startServer();
