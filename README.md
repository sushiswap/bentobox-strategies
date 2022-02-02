# BentoBox Strategies

[BentoBox](https://github.com/sushiswap/bentobox/) is a token vault users can deposit their tokens into. Apps (Trident, Kashi...) can be built on top of BentoBox that use the user's virtual BentoBox balances instead of native token balances, with gas optimization benefits and extra income due to strategies.

BentoBox can allocate a percentage of a token's reserves to be used in an underlying strategy. The profits from the strategy are distributed back into BentoBox. Each strategy has a target balance (e.g. 75%) for the amount of tokens it invests from BentoBox. If any withdrawals or deposits happen in BentoBox anyone can rebalance (deposit into or withdraw from) the strategy so it achieves the target utilization again. To prevent sandwich attacks where a malicious actor deposits some tokens into BentoBox just before a strategy is harvested and withdraw right after (collecting most profits) the permissioned profit harvester can set a condition where a harvest can only happen if the BentoBox token balance is below some limit.

## Deployments

### Polygon - Aave Strategies

Using commit: [4a2ee8a2](https://github.com/sushiswap/bentobox-strategies/tree/4a2ee8a2e069253e47511671226dbcb967baf0e7)

| Token                      | Strategy Address                           |
| -------------------------- | ------------------------------------------ |
| WETH Aave strategy         | 0x760ef4F484EbF2668001B090291f84A3CDf2f3aa |
| USDC Aave strategy         | 0xCFb49550ce8f39c29E73BA0baBc16609A63b31b1 |
| WBTC Aave strategy         | 0xF2CF8109d1c66112132180c0d0f925bDD7b4c246 |
| WMATIC Aave strategy       | 0x7166D2efffCA02c6A21A235732131660c3E61f9F |
| USDT Aave strategy         | 0x59c7459281B4CF2eE96C1CA2A410Fdf03F51A369 |
| DAI Aave strategy          | 0xB6665Ba83e054A91db1e6fC2252b4346a12C60d7 |
| AAVE Aave strategy         | 0x5fB5d087A67d412350060c848b826B9Fb0FE92bA |

| Harvester address                          |
| ------------------------------------------ |
| 0xdC56bD1F319DC1976FD179Ba2A6A76363316a374 |

### Mainnet - Aave Strategies

Using commit: [ac977e88](https://github.com/sushiswap/bentobox-strategies/tree/ac977e88e5721f1aedd016234b8419be271292c1)

| Token                      | Strategy Address                           |
| -------------------------- | ------------------------------------------ |
| WETH Aave strategy         | 0xba45964c74Da01b0D8F44805997c7Fa8E92d214a |
| WBTC Aave strategy         | 0x0d3c6f80B703961e97f245E5c46c4EFb17C9e7A5 |
| USDC Aave strategy         | 0xf130A3dFc255B9a6c613304e1D93ee2cd937085A |
| USDT Aave strategy         | 0x0F6bB13811A09A8D85CDD5726cEB1a6F60Ff9d6C |
| DAI Aave strategy          | 0x68eEa36bC1f2cbB262f09Ed0Eb6Eb353c8251Acd |

| Harvester address                          |
| ------------------------------------------ |
| 0x866151F295Ee4279Fcf3ae2fB483a803400CA491 |

### Avalanche - Aave Strategies

Using commit: [712587c2](https://github.com/sushiswap/bentobox-strategies/commit/712587c260bd4952ab3fc5164ea9ff00d39a8a5c)

| Token                      | Strategy Address                           |
| -------------------------- | ------------------------------------------ |
| WETH Aave strategy         | 0x3808dcF0f03E04Df66e8d71C51A2b57d2164de80 |
| WBTC Aave strategy         | 0x48c0C3b11712843cbC1492CB2C6d90A6bD741eA2 |
| USDC Aave strategy         | 0x66474D334ACB7CC253B76004d65954F7c6D2efD8 |
| USDT Aave strategy         | 0xD264b48092EFEd096a616b97DF401c01b4FD0501 |
| DAI Aave strategy          | 0xEb8704b69C671c832390CA10E5864dFEaa70217D |
| WAVAX Aave strategy        | 0x4bB038e775d74d76427878EAe1B5B0AcA78F23Fe |

| Harvester address                          |
| ------------------------------------------ |
| 0xB6665Ba83e054A91db1e6fC2252b4346a12C60d7 |
