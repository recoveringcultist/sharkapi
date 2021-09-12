'use strict';

import express from 'express';
import cors from 'cors';

import * as admin from 'firebase-admin';
import Web3Crawler from './Web3Crawler';
const serviceAccount = require('../cert/auto-shark-firebase-adminsdk-wfxle-31eb7a6ea3.json');
const lb = require('@google-cloud/logging-bunyan');
import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';

async function startServer() {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://auto-shark-default-rtdb.firebaseio.com/',
  });

  const { logger, mw } = await lb.express.middleware({
    logName: 'crawler',
    serviceContext: {
      service: 'crawler',
    },
  });

  logger.info('starting up');
  const crawler = new Web3Crawler(logger);

  const app = express();
  // Install the logging middleware. This ensures that a Bunyan-style `log`
  // function is available on the `request` object. This should be the very
  // first middleware you attach to your app.
  app.use(mw);

  app.use(cors());

  app.get('/_ah/warmup', (req, res) => {
    console.log('warmup received');
    // Handle your warmup logic. Initiate db connection, etc.
    res.send('success');
  });

  app.get('/', (req, res) => {
    const logger: Logger = (req as any).log;
    logger.info('root url accessed');
    res.status(200).send('crawler').end();
  });

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
  const PORT = process.env.PORT || 8081;
  const server = app.listen(PORT, () => {
    logger.info(`Crawler listening on port ${PORT}`);
    logger.info('Press Ctrl+C to quit.');
    if (process.env.NODE_ENV === 'production') {
      logger.info('running in production mode');
      crawler.start().then(() => {
        logger.info('Crawler started crawling');
      });
    } else {
      logger.info('running in dev mode');
      // console.info('env: ' + JSON.stringify(process.env));
    }
  });

  app.get('/_ah/stop', (req, res) => {
    logger.info('stop received');
    res.send('success');
    if (crawler) {
      crawler.stop();
    }
    if (server) {
      server.close();
    }
  });

  return { app, crawler };
}

module.exports = startServer;

startServer();
