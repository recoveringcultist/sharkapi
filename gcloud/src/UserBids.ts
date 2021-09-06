import Web3 from 'web3';

export interface UserBid {
  auctionId: number;
  amount: number;
}

export interface UserBids {
  address: string;
  bids: UserBid[];
}
