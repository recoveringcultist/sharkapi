import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import { differenceInSeconds } from 'date-fns';
import * as admin from 'firebase-admin';
import { AuctionData } from './common/AuctionData';
import { COLLNAME_AUCTION } from './common/constants';
import * as utils from './common/utils';

export const DB_CRON_IS_RUNNING: string = '/cronIsRunning';
export const DB_CRON_LAST_START: string = '/cronLastStart';
export const DB_CRON_NEXT_AUCTION_ID: string = '/cronNextAuctionId';

export const cronIsRunning = async () => {
  const db = admin.database();
  const data = await db.ref(DB_CRON_IS_RUNNING).once('value');
  const isRunning: boolean = data.val();
  return isRunning;
};

export const setCronRunning = async (value: boolean) => {
  const db = admin.database();
  await db.ref(DB_CRON_IS_RUNNING).set(value);
  if (value) {
    await updateCronLastStart();
  }
};

export const getCronLastStart = async () => {
  const db = admin.database();
  const data = await db.ref(DB_CRON_LAST_START).once('value');
  return data.val();
};

export const updateCronLastStart = async () => {
  const db = admin.database();
  await db.ref(DB_CRON_LAST_START).set(admin.database.ServerValue.TIMESTAMP);
};

export const getCronNextAuctionId = async () => {
  const db = admin.database();
  const data = await db.ref(DB_CRON_NEXT_AUCTION_ID).once('value');
  return data.val();
};

export const setCronNextAuctionId = async (value: number) => {
  const db = admin.database();
  await db.ref(DB_CRON_NEXT_AUCTION_ID).set(value);
};

export const runCron = async (req, res, next) => {
  const logger: Logger = (req as any).log;
  function log(msg) {
    res.write(msg + '\n');
    logger.info(msg);

    if (process.env.NODE_ENV !== 'production') {
      console.info(msg);
    }
  }
  const cronStart: Date = new Date();
  res.status(200);

  // make sure a refresh is not currently running
  const isRunning: boolean = await cronIsRunning();
  if (isRunning) {
    let lastStart = await getCronLastStart();
    let lastStartDate = new Date(lastStart);
    log('cron last start: ' + lastStartDate);
    let now = new Date();
    let difference = differenceInSeconds(now, lastStart);

    log(`runCron: refresh job already running, started ${difference} sec ago.`);
    if (difference > 60 * 60 * 2) {
      logger.error(
        `cronBatch: last start time was over two hours (${difference}s) ago! consider a forced reset`
      );
    }
    return res.end();
  }

  log('runCron: refreshing from blockchain:');

  // set cron running
  await setCronRunning(true);

  // see where we left off
  const lastId = await getCronNextAuctionId();
  let startId: number = lastId != null ? lastId : 0;

  // grab total number of auctions
  let totalAuctions = await utils.bscAuctionsLength(undefined, logger);
  if (startId >= totalAuctions) startId = 0;
  log(
    `runCron: starting processing at: ${startId}, total number of auctions: ${totalAuctions}`
  );

  // set up the next batch
  const maxRefreshes: number = 10;
  let numRefreshes: number = 0;
  const maxAuctionsProcessed: number = 100;
  let numAuctionsProcessed: number = 0;
  let curAuctionId: number = startId;

  const firestore = admin.firestore();
  while (
    numRefreshes < maxRefreshes &&
    numAuctionsProcessed < maxAuctionsProcessed
  ) {
    try {
      // refresh one auction
      // grab the current auction from firestore
      const auctionSnap = await firestore
        .doc(COLLNAME_AUCTION + '/' + curAuctionId)
        .get();
      if (!auctionSnap.exists) {
        log(`auction ${curAuctionId} missing in db, refreshing`);
        // doesn't exist at all, just refresh it
        await utils.refreshAuction(curAuctionId, logger);
        numRefreshes++;
        numAuctionsProcessed++;
        curAuctionId++;
      } else {
        const auctionData: AuctionData = auctionSnap.data() as AuctionData;
        // skip settled auctions
        if (auctionData.isSettled) {
          log(`auction ${curAuctionId} is settled, skipping`);
          numAuctionsProcessed++;
          curAuctionId++;
        } else {
          // not settled, then refresh it
          log(`auction ${curAuctionId} is not settled, refreshing`);
          await utils.refreshAuction(curAuctionId, logger);
          numRefreshes++;
          numAuctionsProcessed++;
          curAuctionId++;
        }
      }

      // wrap around to the beginning if we go off the end
      if (curAuctionId >= totalAuctions) {
        curAuctionId = 0;
      }

      log(
        `current: ${curAuctionId}, numRefreshed: ${numRefreshes}, totalProcessed: ${numAuctionsProcessed}`
      );
    } catch (e: any) {
      utils.reportError(
        e,
        'refreshBatch',
        `refreshing auction ${curAuctionId} failed`,
        logger
      );

      // failedRefreshes.push(i);
    }
  }

  // no longer processing, save where to start next time
  await setCronRunning(false);
  await setCronNextAuctionId(curAuctionId + 1);

  const cronEnd: Date = new Date();
  let runtime = differenceInSeconds(cronEnd, cronStart);
  log('runCron: job took ' + runtime + ' seconds');

  res.end();
};
