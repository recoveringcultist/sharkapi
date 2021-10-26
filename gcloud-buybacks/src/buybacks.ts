import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import * as admin from 'firebase-admin';
import Web3Manager from './Web3Manager'
import { BABY_APEX_VAULT_CONTRACT, BANANA_APEX_VAULT_CONTRACT, BSW_APEX_VAULT_CONTRACT, CAKE_APEX_VAULT_CONTRACT, EXCHANGE_SUBGRAPH_URL, WEI } from './common/constants';

const axios = require('axios');

var buybackData = {buybacks: {finsCoreUSD: 0, cakeApexUSD: 0, bananaApexUSD: 0, bswApexUSD: 0, babyApexUSD: 0}, lastRefresh: 0};

const w3 = new Web3Manager();
const db = admin.database();
const buybacksRef = db.ref('/buybacks');

getData();

export const createBuybackRoutes = (app, log) => {
  app.get('/buybacks', log, buybacksRoute);
};

const buybacksRoute = async (req, res, next) => {
  const logger: Logger = (req as any).log;

  // If data hasn't been refreshed in 12 hours, refresh it
  if ((Date.now() / 1000) - buybackData.lastRefresh >= 43200) {
    getData();
  }

  logger.info('buybacks route called');
  res.json(buybackData);
};


function saveToDB() {
  buybacksRef.set(buybackData)
}

async function retrieveFromDB() {
  let data = await buybacksRef.once('value');
  return data.val();
}

async function getData() {
  let dbData = await retrieveFromDB();

  // If data isn't null and hasn't been more than 12 hours since refresh, use DB data
  if (dbData != null && (Date.now() / 1000) - dbData.lastRefresh < 43200) {

    buybackData = dbData;

  } else {
  // Else refresh it and save to DB

    await getFinsCoreVaultBuybacks();
    await getCakeApexVaultBuybacks();
    await getBananaApexVaultBuybacks();
    await getBSWApexVaultBuybacks();
    await getBabyApexVaultBuybacks();
    buybackData.lastRefresh = Date.now() / 1000;
    //saveToDB();

  }
}

async function getFinsCoreVaultBuybacks() {
  let tvl = await getFinsVaultTVL();
  let totalBuyback = await getFinsCoreVaultTotalBuyback(tvl);
  buybackData.buybacks.finsCoreUSD = totalBuyback;
}

async function getCakeApexVaultBuybacks() {
  let usdFromCake = await getUSDSwappedFromToken(CAKE_APEX_VAULT_CONTRACT);
  let totalBuyback = await getApexVaultTotalBuyback(usdFromCake);
  buybackData.buybacks.cakeApexUSD = totalBuyback;
}

async function getBananaApexVaultBuybacks() {
  let usdFromBanana = await getUSDSwappedFromToken(BANANA_APEX_VAULT_CONTRACT);
  let totalBuyback = await getApexVaultTotalBuyback(usdFromBanana);
  buybackData.buybacks.bananaApexUSD = totalBuyback;
}

async function getBSWApexVaultBuybacks() {
  let usdFromBSW = await getUSDSwappedFromToken(BSW_APEX_VAULT_CONTRACT);
  let totalBuyback = await getApexVaultTotalBuyback(usdFromBSW);
  buybackData.buybacks.bswApexUSD = totalBuyback;
}

async function getBabyApexVaultBuybacks() {
  let usdFromBaby = await getUSDSwappedFromToken(BABY_APEX_VAULT_CONTRACT);
  let totalBuyback = await getApexVaultTotalBuyback(usdFromBaby);
  buybackData.buybacks.babyApexUSD = totalBuyback;
}


/**
 * get USD value of CAKE swapped to FINS from the CAKE vault
 * @returns The total USD value
 */
async function getUSDSwappedFromToken(contract: string) {
  const timeNow = Math.round(Date.now() / 1000)
  var query: String = `
            query Swap {
              swaps(first: 1000, where: {timestamp_gte: ${timeNow - 86400}, to: "${contract}"}) {
                  pair {
                    token0 {
                      symbol
                    }
                    token1 {
                      symbol
                    }
                  }
                  transaction {
                    id
                  }
                  id
                  sender
                  from
                  to
                  amountUSD
                }
            }`
    let data = await axios.post(EXCHANGE_SUBGRAPH_URL, {query: query});
    let total = 0;
    let swaps = data.data.data.swaps;
    for (const swap of swaps) {
      if (swap.id.includes("-1")) {
        let swapAmount = Number(swap.amountUSD);
        total += swapAmount;
      }
    }
    return total;
}

/* 
async function getFinsDailyAPR() {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  var query: String = `
            query Token {
              tokens(where: {symbol: "FINS"}) {
                  derivedUSD
            }
          }`
  let data = await axios.post(EXCHANGE_SUBGRAPH_URL, {query: query});
  console.log(data.data);
  let finsPrice = data.data.data.tokens[0].derivedUSD;
  let dailyReturn = dailyROI * 28800 * finsPrice;
  console.log(dailyReturn);
  return dailyReturn;
} */

async function getFinsVaultTVL() {
  let totalTokens = await w3.getFinsVaultBalance();
  var query: String = `
            query Token {
              tokens(where: {symbol: "FINS"}) {
                  derivedUSD
                }
            }`
  let data = await axios.post(EXCHANGE_SUBGRAPH_URL, {query: query});
  let price = data.data.data.tokens[0].derivedUSD;
  return totalTokens * price;
}

async function getFinsCoreVaultTotalBuyback(tvl: number) {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  return tvl * (dailyROI / 100);
}

async function getApexVaultTotalBuyback(amount: number) {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  let total = amount + (dailyROI * (amount / 1000));
  return total
}

