var zlib = require('zlib');

var redis = require('redis');
var async = require('async');


var os = require('os');

var algos = require('stratum-pool/lib/algoProperties.js');

const loggerFactory = require('./logger.js');
const logger = loggerFactory.getLogger('Stats', 'system');


module.exports = function(logger_, portalConfig, poolConfigs){

    var _this = this;
    var magnitude = 100000000;
    var coinPrecision = magnitude.toString().length - 1;

    var logSystem = 'Stats';

    var redisClients = [];
    var redisStats;

    this.statHistory = [];
    this.statPoolHistory = [];

    this.stats = {};
    this.statsString = '';
    
    logger.debug("Setting up Redis for stats...");
    setupStatsRedis();
    logger.debug("Setting up Redis stat history...");
    gatherStatHistory();

    var canDoStats = true;

    Object.keys(poolConfigs).forEach(function(coin){

        if (!canDoStats) return;

        var poolConfig = poolConfigs[coin];

        var redisConfig = poolConfig.redis;

        for (var i = 0; i < redisClients.length; i++){
            var client = redisClients[i];
            if (client.client.port === redisConfig.port && client.client.host === redisConfig.host){
                client.coins.push(coin);
                return;
            }
        }
        redisClients.push({
            coins: [coin],
            client: redis.createClient(redisConfig.port, redisConfig.host)
        });
    });


    function setupStatsRedis(){
        redisStats = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);
        redisStats.on('error', function(err){
            logger.error('Redis stat module encountered an error: %s', JSON.stringify(err));
        });
    }

    function gatherStatHistory(){

        var retentionTime = (((Date.now() / 1000) - portalConfig.website.stats.historicalRetention) | 0).toString();

        redisStats.zrangebyscore(['statHistory', retentionTime, '+inf'], function(err, replies){
            if (err) {
                logger.error('Redis stat hisotry module encountered an error: %s', JSON.stringify(err));
                return;
            }
            for (var i = 0; i < replies.length; i++){
                _this.statHistory.push(JSON.parse(replies[i]));
            }
            _this.statHistory = _this.statHistory.sort(function(a, b){
                return a.time - b.time;
            });
            _this.statHistory.forEach(function(stats){
                addStatPoolHistory(stats);
            });
        });
    }

    function roundTo(n, digits) {
        if (digits === undefined) {
            digits = 0;
        }
        var multiplicator = Math.pow(10, digits);
        n = parseFloat((n * multiplicator).toFixed(11));
        var test =(Math.round(n) / multiplicator);
        return +(test.toFixed(digits));
    }

    function coinsRound(number) {
        return roundTo(number, coinPrecision);
    }

    var satoshisToCoins = function(satoshis){
        return roundTo((satoshis / magnitude), coinPrecision);
    };
    
    var coinsToSatoshies = function(coins){
        return Math.round(coins * magnitude);
    };

    this.getTotalSharesByAddress = function(address, cback) {
	    var a = address.split(".")[0];
        var client = redisClients[0].client,
            coins = redisClients[0].coins,
            shares = [];

        var pindex = parseInt(0);
		var totalShares = parseFloat(0);
		async.each(_this.stats.pools, function(pool, pcb) {
            pindex++;
			var coin = String(_this.stats.pools[pool.name].name);
			client.hscan(coin + ':shares:roundCurrent', 0, "match", a+"*", "count", 1000, function(error, result) {
                if (error) {
                    pcb(error);
                    return;
                }
				var workerName="";
				var shares = 0;
				for (var i in result[1]) {
					if (Math.abs(i % 2) != 1) {
						workerName = String(result[1][i]);
					} else {
						shares += parseFloat(result[1][i]);
					}
				}
                if (shares>0) {
                    totalShares = shares;
                }
                pcb();
			});
		}, function(err) {
            if (err) {
                cback(0);
                return;
            }
            if (totalShares > 0 || (pindex >= Object.keys(_this.stats.pools).length)) {
                cback(totalShares);
                return;
            }
		});
	};

    this.getBalanceByAddress = function(address, cback){

	    var a = address.split(".")[0];
		
        var client = redisClients[0].client,
            coins = redisClients[0].coins,
            balances = [];
		
		var totalHeld = parseFloat(0);
		var totalPaid = parseFloat(0);
        var totalImmature = parseFloat(0);
				
		async.each(_this.stats.pools, function(pool, pcb) {
			var coin = String(_this.stats.pools[pool.name].name);
			// get all immature balances from address
			client.hscan(coin + ':immature', 0, "match", a+"*", "count", 10000, function(error, pends) {
                // get all balances from address
                client.hscan(coin + ':balances', 0, "match", a+"*", "count", 10000, function(error, bals) {
                    // get all payouts from address
                    client.hscan(coin + ':payouts', 0, "match", a+"*", "count", 10000, function(error, pays) {
                        
                        var workerName = "";
                        var balAmount = 0;
                        var paidAmount = 0;
                        var pendingAmount = 0;
                        
                        var workers = {};
                        
                        for (var i in pays[1]) {
                            if (Math.abs(i % 2) != 1) {
                                workerName = String(pays[1][i]);
                                workers[workerName] = (workers[workerName] || {});
                            } else {
                                paidAmount = parseFloat(pays[1][i]);
                                workers[workerName].paid = coinsRound(paidAmount);
                                totalPaid += paidAmount;
                            }
                        }
                        for (var b in bals[1]) {
                            if (Math.abs(b % 2) != 1) {
                                workerName = String(bals[1][b]);
                                workers[workerName] = (workers[workerName] || {});
                            } else {
                                balAmount = parseFloat(bals[1][b]);
                                workers[workerName].balance = coinsRound(balAmount);
                                totalHeld += balAmount;
                            }
                        }
                        for (var b in pends[1]) {
                            if (Math.abs(b % 2) != 1) {
                                workerName = String(pends[1][b]);
                                workers[workerName] = (workers[workerName] || {});
                            } else {
                                pendingAmount = parseFloat(pends[1][b]);
                                workers[workerName].immature = coinsRound(pendingAmount);
                                totalImmature += pendingAmount;
                            }
                        }
                        
                        for (var w in workers) {
                            balances.push({
                                worker:String(w),
                                balance:workers[w].balance,
                                paid:workers[w].paid,
                                immature:workers[w].immature
                            });
                        }
                        
                        pcb();
                    });
                });
            });
		}, function(err) {
			if (err) {
				callback("There was an error getting balances");
				return;
			}
			
			_this.stats.balances = balances;
			_this.stats.address = address;
			cback({
                totalHeld: coinsRound(totalHeld),
                totalPaid:coinsRound(totalPaid), 
                totalImmature:satoshisToCoins(totalImmature), 
                balances: balances
            });
		});
	};

    function addStatPoolHistory(stats){
        var data = {
            time: stats.time,
            pools: {}
        };
        for (var pool in stats.pools){
            data.pools[pool] = {
                hashrate: stats.pools[pool].hashrate,
                workerCount: stats.pools[pool].workerCount,
                blocks: stats.pools[pool].blocks
            }
        }
        _this.statPoolHistory.push(data);
    }

    this.getGlobalStats = function(callback){

        var statGatherTime = Date.now() / 1000 | 0;

        var allCoinStats = {};

        async.each(redisClients, function(client, callback){
            var windowTime = (((Date.now() / 1000) - portalConfig.website.stats.hashrateWindow) | 0).toString();
            var redisCommands = [];


            var redisCommandTemplates = [
                ['zremrangebyscore', ':hashrate', '-inf', '(' + windowTime],
                ['zrangebyscore', ':hashrate', windowTime, '+inf'],
                ['hgetall', ':stats'],
                ['scard', ':blocksPending'],
                ['scard', ':blocksConfirmed'],
                ['scard', ':blocksKicked'],
                ['smembers', ':blocksPending'],
				['smembers', ':blocksConfirmed'],
				['hgetall', ':shares:roundCurrent'],
                ['hgetall', ':blocksPendingConfirms'],
                ['zrange', ':payments', -100, -1],
                ['hgetall', ':shares:timesCurrent']
            ];

            var commandsPerCoin = redisCommandTemplates.length;

            client.coins.map(function(coin){
                redisCommandTemplates.map(function(t){
                    var clonedTemplates = t.slice(0);
                    clonedTemplates[1] = coin + clonedTemplates[1];
                    redisCommands.push(clonedTemplates);
                });
            });


            client.client.multi(redisCommands).exec(function(err, replies){
                if (err){
                    logger.error('Error encountered while retrieving global stats: %s', JSON.stringify(err));
                    callback(err);
                }
                else{
                    for(var i = 0; i < replies.length; i += commandsPerCoin){
                        var coinName = client.coins[i / commandsPerCoin | 0];
                        var marketStats = {};
                        if (replies[i + 2]) {
                            if (replies[i + 2].coinmarketcap) {
                                marketStats = replies[i + 2] ? (JSON.parse(replies[i + 2].coinmarketcap)[0] || 0) : 0;
                            }
                        }
                        var coinStats = {
                            name: coinName,
                            symbol: poolConfigs[coinName].coin.symbol.toUpperCase(),
                            algorithm: poolConfigs[coinName].coin.algorithm,
                            hashrates: replies[i + 1],
                            poolStats: {
                                validShares: replies[i + 2] ? (replies[i + 2].validShares || 0) : 0,
                                validBlocks: replies[i + 2] ? (replies[i + 2].validBlocks || 0) : 0,
                                invalidShares: replies[i + 2] ? (replies[i + 2].invalidShares || 0) : 0,
                                totalPaid: replies[i + 2] ? (replies[i + 2].totalPaid || 0) : 0,
								networkBlocks: replies[i + 2] ? (replies[i + 2].networkBlocks || 0) : 0,
								networkHps: replies[i + 2] ? (replies[i + 2].networkSols || 0) : 0, 
								networkHpsString: _this.getReadableHashRateString(replies[i + 2] ? (replies[i + 2].networkHash || 0) : 0), 
								networkDiff: replies[i + 2] ? (replies[i + 2].networkDiff || 0) : 0,
								networkConnections: replies[i + 2] ? (replies[i + 2].networkConnections || 0) : 0,
                                networkVersion: replies[i + 2] ? (replies[i + 2].networkSubVersion || 0) : 0,
                                networkProtocolVersion: replies[i + 2] ? (replies[i + 2].networkProtocolVersion || 0) : 0
                            },
                            marketStats: marketStats,
                            /* block stat counts */
                            blocks: {
                                pending: replies[i + 3],
                                confirmed: replies[i + 4],
                                orphaned: replies[i + 5]
                            },
                            /* show all pending blocks */
							pending: {
								blocks: replies[i + 6].sort(sortBlocks),
                                confirms: (replies[i + 9] || {})
							},
                            /* show last 50 found blocks */
							confirmed: {
								blocks: replies[i + 7].sort(sortBlocks).slice(0,50)
							},
                            payments: [],
							currentRoundShares: (replies[i + 8] || {}),
                            currentRoundTimes: (replies[i + 11] || {}),
                            maxRoundTime: 0,
                            shareCount: 0
                        };
                        for(var j = replies[i + 10].length; j > 0; j--){
                            var jsonObj;
                            try {
                                jsonObj = JSON.parse(replies[i + 10][j-1]);
                            } catch(e) {
                                jsonObj = null;
                            }
                            if (jsonObj !== null) { 
                                coinStats.payments.push(jsonObj);
                            }
                        }
                        allCoinStats[coinStats.name] = (coinStats);
                    }
                    // sort pools alphabetically
                    allCoinStats = sortPoolsByName(allCoinStats);
                    callback();
                }
            });
        }, function(err){
            if (err){
                logger.error('Error encountered while retrieving all stored stats: %s', JSON.stringify(err));
                callback();
                return;
            }

            var portalStats = {
                time: statGatherTime,
                global:{
                    workers: 0,
                    hashrate: 0
                },
                algos: {},
                pools: allCoinStats
            };

            Object.keys(allCoinStats).forEach(function(coin){
                var coinStats = allCoinStats[coin];
                coinStats.workers = {};
                coinStats.shares = 0;
                coinStats.hashrates.forEach(function(ins){
                    var parts = ins.split(':');
                    var workerShares = parseFloat(parts[0]);
                    var worker = parts[1];
                    if (workerShares > 0) {
                        coinStats.shares += workerShares;
                        if (worker in coinStats.workers)
                            coinStats.workers[worker].shares += workerShares;
                        else
                            coinStats.workers[worker] = {
                                name: worker,
                                shares: workerShares,
                                invalidshares: 0,
                                currRoundShares: 0,
                                hashrate: 0,
                                hashrateString: null,
                                luckDays: null,
								luckHours: null,
                                paid: 0,
								balance: 0
                            };
                    }
                    else {
                        if (worker in coinStats.workers)
                            coinStats.workers[worker].invalidshares -= workerShares; // workerShares is negative number!
                        else
                            coinStats.workers[worker] = {
                                shares: 0,
                                invalidshares: -workerShares,
                                currRoundShares: 0,
                                hashrate: 0,
                                hashrateString: null,
                                luckDays: null,
								luckHours: null
                            };
                    }
                });
                var _blocktime = 180; //TODO set in config
                var _networkHashRate = parseFloat(coinStats.poolStats.networkHps);
                var shareMultiplier = Math.pow(2, 32) / algos[coinStats.algorithm].multiplier;
                coinStats.hashrate = shareMultiplier * coinStats.shares / portalConfig.website.stats.hashrateWindow;

                coinStats.workerCount = Object.keys(coinStats.workers).length;
                portalStats.global.workers += coinStats.workerCount;

                /* algorithm specific global stats */
                var algo = coinStats.algorithm;
                if (!portalStats.algos.hasOwnProperty(algo)){
                    portalStats.algos[algo] = {
                        workers: 0,
                        hashrate: 0,
                        hashrateString: null
                    };
                }
                portalStats.algos[algo].hashrate += coinStats.hashrate;
                portalStats.algos[algo].workers += Object.keys(coinStats.workers).length;

                var _maxTimeShare = parseFloat(0);
                for (var worker in coinStats.currentRoundShares) {
                    if (worker in coinStats.workers) {
                        coinStats.workers[worker].currRoundShares += parseFloat(coinStats.currentRoundShares[worker]);
                    }
                }
                for (var w in coinStats.workers) {
                    var worker = coinStats.workers[w];
                    var _workerRate = shareMultiplier * worker.shares / portalConfig.website.stats.hashrateWindow;
					var _wHashRate = (_workerRate / 1000000) * 2;
					worker.luckDays = ((_networkHashRate / _wHashRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
					worker.luckHours = ((_networkHashRate / _wHashRate * _blocktime) / (60 * 60)).toFixed(3);
                    worker.hashrateString = _this.getReadableHashRateString(shareMultiplier * worker.shares / portalConfig.website.stats.hashrateWindow);
                    worker.hashrate = _workerRate;
                }

                delete coinStats.hashrates;
                delete coinStats.shares;
                coinStats.hashrateString = _this.getReadableHashRateString(coinStats.hashrate);
            });

            Object.keys(portalStats.algos).forEach(function(algo){
                var algoStats = portalStats.algos[algo];
                algoStats.hashrateString = _this.getReadableHashRateString(algoStats.hashrate);
            });

            _this.stats = portalStats;
            _this.statsString = JSON.stringify(portalStats);



            _this.statHistory.push(portalStats);
            addStatPoolHistory(portalStats);

            var retentionTime = (((Date.now() / 1000) - portalConfig.website.stats.historicalRetention) | 0);

            for (var i = 0; i < _this.statHistory.length; i++){
                if (retentionTime < _this.statHistory[i].time){
                    if (i > 0) {
                        _this.statHistory = _this.statHistory.slice(i);
                        _this.statPoolHistory = _this.statPoolHistory.slice(i);
                    }
                    break;
                }
            }

            redisStats.multi([
                ['zadd', 'statHistory', statGatherTime, _this.statsString],
                ['zremrangebyscore', 'statHistory', '-inf', '(' + retentionTime]
            ]).exec(function(err, replies){
                if (err)
                logger.error('Error encountered while adding entry to stat history: %s', JSON.stringify(err));
            });
            callback();
        });

    };

    /**
     * Sort object properties (only own properties will be sorted).
     * @param {object} obj object to sort properties
     * @param {string|int} sortedBy 1 - sort object properties by specific value.
     * @param {bool} isNumericSort true - sort object properties as numeric value, false - sort as string value.
     * @param {bool} reverse false - reverse sorting.
     * @returns {Array} array of items in [[key,value],[key,value],...] format.
     */
    function sortProperties(obj, sortedBy, isNumericSort, reverse) {
        sortedBy = sortedBy || 1; // by default first key
        isNumericSort = isNumericSort || false; // by default text sort
        reverse = reverse || false; // by default no reverse

        var reversed = (reverse) ? -1 : 1;

        var sortable = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                sortable.push([key, obj[key]]);
            }
        }
        if (isNumericSort)
            sortable.sort(function (a, b) {
                return reversed * (a[1][sortedBy] - b[1][sortedBy]);
            });
        else
            sortable.sort(function (a, b) {
                var x = a[1][sortedBy].toLowerCase(),
                    y = b[1][sortedBy].toLowerCase();
                return x < y ? reversed * -1 : x > y ? reversed : 0;
            });
        return sortable; // array in format [ [ key1, val1 ], [ key2, val2 ], ... ]
    }

    function sortPoolsByName(objects) {
		var newObject = {};
		var sortedArray = sortProperties(objects, 'name', false, false);
		for (var i = 0; i < sortedArray.length; i++) {
			var key = sortedArray[i][0];
			var value = sortedArray[i][1];
			newObject[key] = value;
		}
		return newObject;
    }
    
    function sortBlocks(a, b) {
        var as = parseInt(a.split(":")[2]);
        var bs = parseInt(b.split(":")[2]);
        if (as > bs) return -1;
        if (as < bs) return 1;
        return 0;
    }
	
	function sortWorkersByName(objects) {
		var newObject = {};
		var sortedArray = sortProperties(objects, 'name', false, false);
		for (var i = 0; i < sortedArray.length; i++) {
			var key = sortedArray[i][0];
			var value = sortedArray[i][1];
			newObject[key] = value;
		}
		return newObject;
	}
	
	function sortMinersByHashrate(objects) {
		var newObject = {};
		var sortedArray = sortProperties(objects, 'shares', true, true);
		for (var i = 0; i < sortedArray.length; i++) {
			var key = sortedArray[i][0];
			var value = sortedArray[i][1];
			newObject[key] = value;
		}
		return newObject;
	}
	
	function sortWorkersByHashrate(a, b) {
		if (a.hashrate === b.hashrate) {
			return 0;
		}
		else {
			return (a.hashrate < b.hashrate) ? -1 : 1;
		}
	}

    this.getReadableHashRateString = function(hashrate){
        var i = -1;
        var byteUnits = [ ' KH/s', ' MH/s', ' GH/s', ' TH/s', ' PH/s' ];
        do {
            hashrate = hashrate / 1000;
			i++;
        } while (hashrate > 1000);
        return hashrate.toFixed(2) + byteUnits[i];
    };

};
