'use strict';

import express from 'express';
import cors from 'cors';
import { createApiRoutes, createCronRoutes } from './api';

import * as admin from 'firebase-admin';
import Web3Manager from './Web3Manager';
const serviceAccount = require('../cert/auto-shark-firebase-adminsdk-wfxle-31eb7a6ea3.json');
const lb = require('@google-cloud/logging-bunyan');
import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';

async function startServer() {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://auto-shark-default-rtdb.firebaseio.com/',
  });
  const firestore = admin.firestore();

  const { logger, mw: defaultLog } = await lb.express.middleware({
    logName: 'default',
    serviceContext: {
      service: 'default',
    },
  });
  const { mw: cronLog } = await lb.express.middleware({
    logName: 'cron',
    serviceContext: {
      service: 'default',
    },
  });

  const app = express();
  // Install the logging middleware. This ensures that a Bunyan-style `log`
  // function is available on the `request` object. This should be the very
  // first middleware you attach to your app.
  // app.use(defaultLog);

  app.use(cors());

  app.get('/_ah/warmup', defaultLog, (req, res) => {
    // Handle your warmup logic. Initiate db connection, etc.
    res.send('success');
  });

  app.get('/', defaultLog, (req, res) => {
    res.status(200).send('sharkapi').end();
  });
  createCronRoutes(app, cronLog);
  createApiRoutes(app, defaultLog);

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
    logger.info(`App listening on port ${PORT}`);
    logger.info('Press Ctrl+C to quit.');
  });

  // setInterval(function () {
  //   console.log('ping');
  // }, 1000 * 60);

  return app;
}

module.exports = startServer;

startServer();
