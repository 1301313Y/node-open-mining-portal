var redis = require('redis');
var async = require('async');

var stats = require('./stats.js');

module.exports = function(logger, portalConfig, poolConfigs){


    var _this = this;

    var portalStats = this.stats = new stats(logger, portalConfig, poolConfigs);

    this.liveStatConnections = {};

    this.handleApiRequest = function(req, res, next){
        switch(req.params.method){
            case 'stats':
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(portalStats.statsString);
                return;
            case 'pool_stats':
                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (req.url.indexOf("?") > 0) {
                    var url_parms = req.url.split("?");
                    if (url_parms.length > 0) {
                        var pool = url_parms[1] || null;
                        if(pool) {
                            res.end(JSON.stringify(
                                {
                                    stats: portalStats.stats.pools[pool],
                                    history: portalStats.statPoolHistory.map((i) => {
                                        return {
                                            time: i.time,
                                            data: i.pools[pool]
                                        };
                                    })
                                }
                            ));
                            return;
                        } else {
                            res.end(JSON.stringify({result: "Error", message: "Pool name could not be read!"}));
                        }
                    } else {
                        res.end(JSON.stringify({result: "Error", message: "Must include pool name!"}));
                    }
                } else {
                    res.end(JSON.stringify(portalStats.statPoolHistory));
                }
                return;
            case 'payments':
                var poolBlocks = [];
                for(var pool in portalStats.stats.pools) {
                    poolBlocks.push({name: pool, pending: portalStats.stats.pools[pool].pending, payments: portalStats.stats.pools[pool].payments});
                }
                res.header('Content-Type', 'application/json');
                res.end(JSON.stringify(poolBlocks));
                return;
            case 'worker_stats':
				res.header('Content-Type', 'application/json');
				if (req.url.indexOf("?") > 0) {
                    var url_parms = req.url.split("?");
                    if (url_parms.length > 0) {
                        var history = {};
                        var workers = {};
                        var pool = url_parms[1] || null;
                        //res.end(portalStats.getWorkerStats(address));
                        if (pool != null && pool.length > 0) {
                            // make sure it is just the miners address
                            pool = pool.split(".")[0];
                            // get miners balance along with worker balances
                            portalStats.getBalanceByAddress(pool, function(balances) {
                                // get current round share total
                                portalStats.getTotalSharesByAddress(pool, function(shares) {
                                    var totalHash = parseFloat(0.0);
                                    var totalShares = shares;
                                    var networkHps = 0;
                                    for (var h in portalStats.statHistory) {
                                        for(var pool in portalStats.statHistory[h].pools) {
                                            for(var w in portalStats.statHistory[h].pools[pool].workers){
                                                if (w.toLowerCase().charAt(0) === pool.toLowerCase().charAt(0)) {
                                                    if (history[w] == null) {
                                                        history[w] = [];
                                                    }
                                                    if (portalStats.statHistory[h].pools[pool].workers[w].hashrate) {
                                                        history[w].push({time: portalStats.statHistory[h].time, hashrate:portalStats.statHistory[h].pools[pool].workers[w].hashrate});
                                                    }
                                                }
                                            }
                                            // order check...
                                            //console.log(portalStats.statHistory[h].time);
                                        }
                                    }
                                    for(var pool in portalStats.stats.pools) {
                                        for(var w in portalStats.stats.pools[pool].workers){
                                            if (w.toLowerCase().charAt(0) === pool.toLowerCase().charAt(0)) {
                                                workers[w] = portalStats.stats.pools[pool].workers[w];
                                                for (var b in balances.balances) {
                                                    if (w == balances.balances[b].worker) {
                                                        workers[w].paid = balances.balances[b].paid;
                                                        workers[w].balance = balances.balances[b].balance;
                                                    }
                                                }
                                                workers[w].balance = (workers[w].balance || 0);
                                                workers[w].paid = (workers[w].paid || 0);
                                                totalHash += portalStats.stats.pools[pool].workers[w].hashrate;
                                                networkHps = portalStats.stats.pools[pool].poolStats.networkHps;
                                            }
                                        }
                                    }
                                    res.end(JSON.stringify({miner: pool, totalHash: totalHash, totalShares: totalShares, networkHps: networkHps, immature: balances.totalImmature, balance: balances.totalHeld, paid: balances.totalPaid, workers: workers, history: history}));
                                });
                            });
                        } else {
                            res.end(JSON.stringify({result: "error3"}));
                        }
                    } else {
                        res.end(JSON.stringify({result: "error2"}));
                    }
				} else {
					res.end(JSON.stringify({result: "error1"}));
				}
                return;
            case 'live_stats':
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
                res.write('\n');
                var uid = Math.random().toString();
                _this.liveStatConnections[uid] = res;
                req.on("close", function() {
                    delete _this.liveStatConnections[uid];
                });
                return;
            default:
                next();
        }
    };


    this.handleAdminApiRequest = function(req, res, next){
        switch(req.params.method){
            case 'pools': {
                res.end(JSON.stringify({result: poolConfigs}));
                return;
            }
            default:
                next();
        }
    };

};
