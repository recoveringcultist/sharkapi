import { differenceInMinutes, differenceInSeconds } from 'date-fns';
import { Contract, providers } from 'ethers';
import * as admin from 'firebase-admin';
import { firestore } from 'firebase-admin';
import Web3 from 'web3';
import {
  AuctionData,
  AUCTION_FIELDS,
  AUCTION_FIELD_TYPES,
} from './AuctionData';
import * as MarketplaceABI from './NftMarketplace.json';
import { UserBids } from './UserBids';
import * as utils from './utils';

export const createApiRoutes = (app) => {
  app.get('/api/auctionraw/:id', auctionRaw);
  app.get('/api/auctionrefresh/:id', auctionRefresh);
  app.get('/api/auction/:id', auctionDetail);
  app.get('/api/auction', api);
  app.get('/api/bidbalanceuser/:address', bidBalanceUser);
  app.get('/api/userbids/:address', userBids);
  app.get('/api/userbidsrefresh/:address', userBidsRefresh);
  app.get('/api/refreshcron', refreshCron);
  app.get('/api/bsc/auctionslength', bscAuctionsLength);
  app.get('/api/bsc/auction/:id', bscAuction);
  app.get('/api/bsc/bidbalance/:id/:address', bscBidBalance);
  app.get('/api/bsc/bidbalanceuser/:address', bscBidBalanceForUser);
  app.get('/api/bsc/highestbid/:id', bscHighestBid);
  app.get('/api/bsc/getuserbidslength/:address', bscGetUserBidsLength);
  app.get('/api/bsc/getuserbids/:address', bscGetUserBids);
  // app.get('/api/maintenance1', maintenance1);
  // app.get('/api/tmp', temp);
  // app.get('/api/refreshall', refreshAll);
};

const api = async (req, res, next) => {
  try {
    const firestore = admin.firestore();

    // console.info(req.query);

    const nftWhereFields = ['series', 'rarity', 'tier'];
    const equalityWhereFields = [
      'auctionId',
      'nftToken',
      'nftTokenId',
      'owner',
      'token',
      'isSettled',
      'highestBidder',
      'auctionType',
      'isSold',
      'lastToken',
    ];
    const inequalityWhereFields = ['endsBefore', 'endsAfter'];
    const allWhereFields = [
      ...equalityWhereFields,
      ...inequalityWhereFields,
      ...nftWhereFields,
    ];
    const allOrderFields = [
      'endTime',
      'auctionId',
      'nftTokenId',
      'rarity',
      'tier',
    ];
    const nftOrderFields = ['rarity', 'tier'];
    const extraValidParams = [
      'direction',
      'limit',
      'startAfter',
      'orderby',
      'orderBy',
    ];
    const allValidParams = [...allWhereFields, ...extraValidParams];

    // reject invalid params
    for (const param of Object.keys(req.query)) {
      // console.info(param);
      if (!allValidParams.includes(param)) {
        return next(
          new Error(
            `invalid param ${param}. valid params are ${allValidParams.join(
              ', '
            )}`
          )
        );
      }
    }

    // parse where
    // sold, ended, active, owner (is user the owner of auction), nft series, rarity, tier
    const whereClauses: {
      [key: string]: { op: FirebaseFirestore.WhereFilterOp; val: any };
    } = {};
    for (const field of allWhereFields) {
      if (req.query[field] != null) {
        const valStr: string = req.query[field];

        // determine type of auctiondata fields
        if (AUCTION_FIELD_TYPES[field] != null) {
          switch (AUCTION_FIELD_TYPES[field]) {
            case 'string':
              whereClauses[field] = { op: '==', val: valStr };
              break;
            case 'number':
              whereClauses[field] = {
                op: '==',
                val: parseFloat(valStr),
              };
              break;
            case 'int':
              whereClauses[field] = { op: '==', val: parseInt(valStr) };
              break;
            case 'intarray':
              // allow a comma-separated array of ints. if only one value, just treat it as an int
              const pieces = valStr.split(',').map((val) => parseInt(val));
              if (pieces.length === 1) {
                // one int
                whereClauses[field] = { op: '==', val: pieces[0] };
              } else {
                // several ints
                whereClauses[field] = { op: 'in', val: pieces };
              }
              break;
            case 'boolean':
              if (valStr.toLowerCase() == 'false') {
                whereClauses[field] = { op: '==', val: false };
              } else {
                whereClauses[field] = { op: '==', val: true };
              }
              break;
            default:
              return next(new Error('cannot determine type of field ' + field));
          }
        } else if (field == 'endsBefore' || field == 'endsAfter') {
          // inequalities
          const timestamp = parseFloat(valStr);
          whereClauses['endTime'] = {
            op: field == 'endsBefore' ? '<' : '>',
            val: timestamp,
          };
        } else {
        }
      }
    }

    // parse orderby
    // endTime, auctionId, nftId, rarity, tier
    let orderBy;
    if (req.query.orderby != null) {
      orderBy = req.query.orderby || req.query.orderBy;

      if (!allOrderFields.includes(orderBy)) {
        return next(
          new Error('accepted orderby values are ' + allOrderFields.join(','))
        );
      }

      // special cases
      if (orderBy === 'rarity' && whereClauses[orderBy] != null) {
        // attempting to filter AND sort by rarity doesn't work in firestore
        orderBy = null;
      }
    } else {
      // default orderby is auctionId, but only if the query is going to return more than one item
      if (
        whereClauses['auctionId'] == null &&
        whereClauses['nftTokenId'] == null
      ) {
        orderBy = 'auctionId';
      }
    }

    const direction = req.query.direction || 'asc';
    if (direction != null && direction != 'asc' && direction != 'desc') {
      return next(new Error('accepted direction values are asc, desc'));
    }

    // parse limit, startAfter
    let limit = 20;
    if (req.query.limit != null) {
      limit = parseInt(req.query.limit);
    }
    let startAfter: any = null;
    if (req.query.startAfter != null) {
      switch (orderBy) {
        case 'endTime':
        case 'auctionId':
        case 'nftTokenId':
        case 'rarity':
        case 'tier':
          startAfter = parseInt(req.query.startAfter);
          break;
      }
    }

    // create query
    let query: FirebaseFirestore.Query = firestore.collection(
      utils.COLLNAME_AUCTION
    );

    // where clauses
    if (Object.keys(whereClauses).length > 0) {
      // console.info(whereClauses);
      for (const key in whereClauses) {
        const val = whereClauses[key].val;
        const op = whereClauses[key].op;
        const whereField = nftWhereFields.includes(key)
          ? 'nftData.' + key
          : key;
        // console.info(whereField, op, val);
        query = query.where(whereField, op, val);
      }
    }

    // order by
    if (orderBy != null) {
      if (nftOrderFields.includes(orderBy)) {
        orderBy = 'nftData.' + orderBy;
      }

      query = query.orderBy(orderBy, direction);
    }

    // limit and startAfter
    if (limit > 0) query = query.limit(limit);
    if (startAfter != null) {
      query = query.startAfter(startAfter);
    }

    // execute query
    const snap = await query.get();

    let ret: any = [];
    for (const doc of snap.docs) {
      let auctionData: AuctionData = doc.data() as AuctionData;

      ret.push(auctionData);
    }

    res.json(ret);
  } catch (err) {
    return next(err);
  }
};

const auctionDetail = async (req, res, next) => {
  const firestore = admin.firestore();

  const id = parseInt(req.params.id);
  if (req.params.id == null || isNaN(id)) return next(new Error('no id'));

  const auctionData: AuctionData = await utils.getAuctionData(id);
  res.json(auctionData);
};

const auctionRefresh = async (req, res, next) => {
  const firestore = admin.firestore();

  const id = parseInt(req.params.id);
  if (req.params.id == null || isNaN(id)) return next(new Error('no id'));

  try {
    await utils.refreshAuction(id);

    res.send('success');
  } catch (err) {
    return next(err);
  }
};

/**
 * get auction data straight from blockchain
 * @param req
 * @param res
 * @param next
 * @returns
 */
const auctionRaw = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (req.params.id == null || isNaN(id)) return next(new Error('no id'));

    const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
      id,
      false
    ); // await utils.loadAuctionDataBlockchain(id);

    res.json(auctionData);
  } catch (err) {
    return next(err);
  }
};

/**
 *
 * @param req
 * @param res
 * @param next
 */
const bscAuctionsLength = async (req, res, next) => {
  try {
    const result = await utils.bscAuctionsLength();
    return res.json(result);
  } catch (err) {
    return next(err);
  }
};

/**
 * call auction() on the blockchain
 * @param req
 * @param res
 * @param next
 * @returns
 */
const bscAuction = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (req.params.id == null || isNaN(id)) return next(new Error('no id'));

    const result = await utils.bscGetAuction(id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
};

const bscHighestBid = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (req.params.id == null || isNaN(id)) return next(new Error('no id'));

    const contract = utils.getMarketplaceContract();
    const result = await utils.bscGetHighestBid(contract, id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
};

/**
 * get bid balance from blockchain. requires :id and :address
 * @param req
 * @param res
 * @param next
 * @returns
 */
const bscBidBalance = async (req, res, next) => {
  try {
    const contract = utils.getMarketplaceContract();

    const id = parseInt(req.params.id);
    if (req.params.id == null || isNaN(id)) throw new Error('no id');
    const address: string = req.params.address;
    if (address == null) throw new Error('no address');

    const balance = await utils.bscGetBidBalance(id, address, contract);
    res.json(balance);
  } catch (err) {
    return next(err);
  }
};

/**
 * get userBids from database
 * @param req
 * @param res
 * @param next
 * @returns
 */
const userBids = async (req, res, next) => {
  try {
    const address: string = req.params.address;
    if (address == null) throw new Error('no address');

    const result = await utils.getUserBids(address);
    res.json(result);
  } catch (err) {
    return next(err);
  }
};

/**
 * refresh user bids from blockchain
 * @param req
 * @param res
 * @param next
 * @returns
 */
const userBidsRefresh = async (req, res, next) => {
  const firestore = admin.firestore();

  const address: string = req.params.address;
  if (address == null) throw new Error('no address');

  try {
    await utils.refreshUserBids(address);

    res.send('success');
  } catch (err) {
    return next(err);
  }
};

/**
 * get the auctions the user has a balance in
 * @param req
 * @param res
 * @param next
 * @returns
 */
const bidBalanceUser = async (req, res, next) => {
  try {
    const address: string = req.params.address;
    if (address == null) throw new Error('no address');

    const result = await utils.getBidBalanceUser(address);
    res.json(result);
  } catch (err) {
    return next(err);
  }
};

/**
 * get bid balance from blockchain for all auctions for user. requires :address
 * @param req
 * @param res
 * @param next
 * @returns
 */
const bscBidBalanceForUser = async (req, res, next) => {
  function log(msg) {
    res.write(msg + '\n');
    console.info(msg);
  }

  try {
    const contract = utils.getMarketplaceContract();

    const address: string = req.params.address;
    if (address == null) throw new Error('no address');

    const numAuctions_ = await contract.auctionsLength();
    const numAuctions = parseInt(numAuctions_.toString());

    res.status(200);

    log(`${numAuctions} total auctions`);

    for (let i = 0; i < numAuctions; i++) {
      const balance = await utils.bscGetBidBalance(i, address, contract);
      if (balance > 0) {
        log(`auction ${i}, balance ${balance}`);
      }
    }

    log('finished');

    res.end();
  } catch (err) {
    return next(err);
  }
};

const bscGetUserBidsLength = async (req, res, next) => {
  try {
    const address: string = req.params.address;
    if (address == null) throw new Error('no address');

    const result = await utils.bscGetUserBidsLength(address);
    res.json(result);
  } catch (err) {
    return next(err);
  }
};

const bscGetUserBids = async (req, res, next) => {
  try {
    const address: string = req.params.address;
    if (address == null) throw new Error('no address');

    const result = await utils.bscGetUserBids(address);
    res.json(result);
  } catch (err) {
    return next(err);
  }
};

/**
 * refresh a batch of auctions
 * @param start
 * @param end
 */
const refreshBatch = async (start: number, end: number) => {
  console.info(`refreshBatch: refreshing from ${start} to ${end}:`);

  let refreshOn = false;
  let failedRefreshes: number[] = [];
  for (let i = start; i < end; i++) {
    try {
      console.info(`refreshBatch: refreshing auction ${i}`);
      await utils.refreshAuction(i);

      // wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e: any) {
      utils.reportError(e, 'refreshBatch', `queueing auction ${i} for retry`);

      failedRefreshes.push(i);
    }
  }

  // try the ones again that failed
  for (const id of failedRefreshes) {
    try {
      console.info(`refreshBatch: refreshing previously failed auction ${id}`);
      await utils.refreshAuction(id);

      // wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e: any) {
      utils.reportError(
        e,
        'refreshBatch',
        `auction ${id} failed for the second time, skipping`
      );
    }
  }

  console.info('refreshBatch: complete');
};

const refreshCron = async (req, res) => {
  const firestore = admin.firestore();
  function log(msg) {
    res.write(msg + '\n');
    console.info(msg);
  }

  const cronStart: Date = new Date();

  res.status(200);

  // make sure a refresh is not currently running
  const running = await firestore.doc('cron/running').get();
  if (running.exists && (running.data() as any).running == true) {
    let runningData: {
      startTime: admin.firestore.Timestamp;
      running: boolean;
    } = running.data() as any;
    if (runningData.running) {
      let startTime = runningData.startTime.toDate();
      let now = new Date();
      let difference = differenceInSeconds(now, startTime);

      log(
        `refreshCron: refresh job already running, started ${difference} sec ago.`
      );
      if (difference > 60 * 60 * 2) {
        console.error(
          `cronBatch: last start time was over two hours (${difference}s) ago! consider a forced reset`
        );
      }
      return res.end();
    }
  }

  log('refreshCron: refreshing from blockchain:');

  await firestore.doc('cron/running').set({
    running: true,
    startTime: admin.firestore.FieldValue.serverTimestamp(),
  });

  // see where we left off
  const cronSnap = await firestore.doc('cron/last').get();
  let startId: number = 0;
  if (!cronSnap.exists) {
    // first time running cron
  } else {
    const cronData: any = cronSnap.data();
    startId = cronData.startId;
  }

  // grab total number of auctions
  let numAuctions = await utils.bscAuctionsLength();
  log(`refreshCron: number of auctions: ${numAuctions}`);

  // set up the next batch
  const batchSize: number = 10;

  // did we go to the end last time? wrap around
  if (startId >= numAuctions) {
    startId = 0;
  }

  // don't go past the end of auctions
  let endId: number = startId + batchSize;
  if (endId >= numAuctions) endId = numAuctions;

  try {
    log(`refreshCron: refreshing batch ${startId} to ${endId}`);
    await refreshBatch(startId, endId);
    log(`refreshCron: batch finished, next start=${endId}`);

    // save where to start next time
    await firestore.doc('cron/last').set({
      startId: endId,
    });
  } catch (e: any) {
    log(`refreshCron: error refreshing batch ${startId} to ${endId}`);
    log(e.message + '\n' + e.stack);
  }

  await firestore.doc('cron/running').update({ running: false });

  const cronEnd: Date = new Date();
  let runtime = differenceInSeconds(cronEnd, cronStart);
  log('refreshCron: job took ' + runtime + ' seconds');

  res.end();
};

const refreshAll = async (req, res) => {
  function log(msg) {
    res.write(msg + '\n');
    console.info(msg);
  }

  res.status(200);
  log('refreshAll: refreshing from blockchain:');

  // grab total number of auctions
  let numAuctions = await utils.bscAuctionsLength();
  log(`refreshAll: number of auctions: ${numAuctions}`);

  let refreshOn = false;
  let failedRefreshes: number[] = [];
  for (let i = 0; i < numAuctions; i++) {
    // check each auction in the db until we find one that's not settled.
    // and then refresh each one from then on

    if (!refreshOn) {
      const existingData: AuctionData = await utils.getAuctionData(i);
      if (!existingData.isSettled) {
        refreshOn = true;
      } else {
        continue;
      }
    }

    if (refreshOn) {
      try {
        log(`refreshAll: refreshing auction ${i}`);
        await utils.refreshAuction(i);

        // wait a bit
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (e: any) {
        log('refreshAll: error refreshing auction ' + i + ', skipping');
        log(e.message + '\n' + e.stack);

        failedRefreshes.push(i);
      }
    }
  }

  // try the ones again that failed
  for (const id of failedRefreshes) {
    try {
      log(`refreshAll: refreshing previously failed auction ${id}`);
      await utils.refreshAuction(id);

      // wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e: any) {
      log(
        'refreshAll: error refreshing auction ' +
          id +
          'for the second time, skipping'
      );
      log(e.message + '\n' + e.stack);
    }
  }

  log('refreshAll: complete');

  res.end();
  // res.status(200).send(response).end();
};
