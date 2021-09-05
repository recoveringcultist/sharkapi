import * as functions from 'firebase-functions';
import Web3 from 'web3';
// import { supabase } from "../utils/shark-db";
import * as MarketplaceABI from './NftMarketplace.json';
import { Contract, providers } from 'ethers';
import * as admin from 'firebase-admin';

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//

// const firebaseApp: admin.app.App = admin.initializeApp();
// const firestore: admin.firestore.Firestore = admin.firestore();
