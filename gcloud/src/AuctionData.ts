import Web3 from 'web3';

/*
  "lastPrice": 0,
  "lastToken": "0x0000000000000000000000000000000000000000",
  "finalHighestBid": 0

*/

/*
{
  "id": "3271",
  "series": "1000",
  "description": "Snide Shark Society are a series of NFTs living on the Binance Smart Chain. Utilise them to power your vaults, or become a full time breeder lusting over the Sharks with the best traits. Auction, Trade and Forge your own! Who says sharks can only be found in the sea? In addition, get access to our exclusive club on telegram if you have Snide Shark Society and weld it as your profile picture!",
  "external_url": "https://autoshark.finance/nft",
  "image": "https://nft.autoshark.finance/images/hammer-1.jpg",
  "name": "AutoShark Collectibles, Tier 1: Hammer",
  "rarity": 1,
  "tier": 1
}
*/

/*
{
  "id": 448,
  "auctionId": 244,
  "nftToken": "0x13e14f6EC8fee53b69eBd4Bd69e35FFCFe8960DE",
  "nftTokenId": 991,
  "owner": "0x3D72A0EE73159F73183333942CC1E511d9b35636",
  "token": "0x0000000000000000000000000000000000000000",
  "targetPrice": 1.5,
  "reservePrice": 0,
  "endTime": 1630265053,
  "minIncrement": 0.07,
  "isSettled": true,
  "highestBidder": "0x0000000000000000000000000000000000000000",
  "auctionType": 0,
  "isSold": false,
  "lastPrice": 0,
  "lastToken": "0x0000000000000000000000000000000000000000",
  "finalHighestBid": 0
}
*/

export interface NftData {
  id: string;
  series: string;
  description: string;
  external_url: string;
  image: string;
  name: string;
  rarity: number;
  tier?: number;
}

export interface AuctionData {
  auctionId: number;
  nftToken: string;
  nftTokenId: number;
  owner: string;
  token: string;
  targetPrice: number;
  reservePrice: number;
  endTime: number;
  minIncrement: number;
  isSettled: boolean;
  highestBidder: string;
  auctionType: number;
  isSold: boolean;
  lastPrice?: number;
  lastToken?: string;
  finalHighestBid?: number;
  highestBid?: number;
  nftData?: NftData;
}
export const AUCTION_FIELD_TYPES: any = {
  auctionId: 'int',
  nftToken: 'string',
  nftTokenId: 'int',
  owner: 'string',
  token: 'string',
  targetPrice: 'number',
  reservePrice: 'number',
  endTime: 'int',
  minIncrement: 'number',
  isSettled: 'boolean',
  highestBidder: 'string',
  auctionType: 'int',
  isSold: 'boolean',
  lastPrice: 'number',
  lastToken: 'string',
  finalHighestBid: 'number',
  highestBid: 'number',
  series: 'string',
  rarity: 'intarray',
  tier: 'int',
};
export const AUCTION_FIELDS: string[] = [
  'auctionId',
  'nftToken',
  'nftTokenId',
  'owner',
  'token',
  'targetPrice',
  'reservePrice',
  'endTime',
  'minIncrement',
  'isSettled',
  'highestBidder',
  'auctionType',
  'isSold',
  'lastPrice',
  'lastToken',
  'finalHighestBid',
];

export function createAuctionData(
  auctionId: number,
  auction: any
): AuctionData {
  const {
    nftToken,
    nftTokenId,
    owner,
    token,
    targetPrice,
    reservePrice,
    endTime,
    minIncrement,
    isSettled,
    highestBidder,
    auctionType,
    isSold,
  } = auction;

  const ret: AuctionData = {
    auctionId,
    nftToken,
    nftTokenId: nftTokenId.toString(),
    owner,
    token,
    targetPrice: parseFloat(
      Web3.utils.fromWei(targetPrice.toString(), 'ether')
    ),
    reservePrice: parseFloat(
      Web3.utils.fromWei(reservePrice.toString(), 'ether')
    ),
    endTime: parseInt(endTime.toString()),
    minIncrement: parseFloat(
      Web3.utils.fromWei(minIncrement.toString(), 'ether')
    ),
    isSettled,
    highestBidder,
    auctionType,
    isSold,
  };
  return ret;
}
