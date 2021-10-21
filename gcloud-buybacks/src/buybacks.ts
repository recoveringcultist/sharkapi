import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import * as admin from 'firebase-admin';

export const createBuybackRoutes = (app, log) => {
  app.get('/sampleroute', log, sampleRoute);
};

const sampleRoute = async (req, res, next) => {
  const logger: Logger = (req as any).log;

  // database reference
  const firestore = admin.firestore();

  logger.info('buybacks sample route called');
  res.send('buybacks sample route');
};
