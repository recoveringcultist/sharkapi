import Web3 from 'web3';
import { AuctionData } from './AuctionData';

export interface UserBid {
  auctionId: number;
  amount: number;
}

export interface UserBids {
  address: string;
  bids: UserBid[];
}

export interface UserBidsInfo {
  address: string;
  bids: UserBidInfo[];
}

export interface UserBidInfo extends UserBid {
  auctionData: AuctionData;
}
