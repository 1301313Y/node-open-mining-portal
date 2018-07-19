$(window).on("load", function () {
    var chartColors = [
        '#e91e63',
        '#9c27b0',
        '#673ab7',
        '#f44336',
        '#3f51b5',
        '#2196f3',
        '#03a9f4',
        '#00bcd4',
        '#009688',
        '#4caf50',
        '#8bc34a',
        '#cddc39',
        '#ffeb3b',
        '#ffc107',
        '#ff9800',
        '#ff5722',
        '#795548',
        '#9e9e9e',
        '#607d8b'
    ];
    var skipCap = 5;
    var skipIndex = skipCap;
    var charts = {
        workers: undefined,
        hashrate: undefined,
        distWorkers: undefined,
        distHashrate: undefined
    };
    var graphData = {
        workers: [],
        hashrate: [],
        blocks: []
    };
    var getHashrateString = function (hash) {
        var hashrate = hash;
        var i = 0;
        var units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
        while (hashrate > 1000) {
            hashrate = hashrate / 1000;
            i++;
        }
        return hashrate === null ? `0 H/s` : hashrate.toFixed(2) + ' ' + units[i];
    };
    var emaProcess = function(dataObjArray, timePeriods = 12){
        var k = 2/(timePeriods + 1);
        // first item is just the same as the first item in the input
        dataObjArray[0].ema = dataObjArray[0].original;
        let emaArray = [dataObjArray[0]];
        // for the rest of the items, they are computed with the previous one
        for (let i = 1; i < dataObjArray.length; i++) {
            let e = dataObjArray[i].original * k;
            e += emaArray[i - 1].ema * (1 - k);
            dataObjArray[i].ema = e;
            emaArray.push(dataObjArray[i]);
        }
        return dataObjArray;
    };
    var getTransparentHex = function (hex, opacity){
        hex = hex.replace('#','');
        let r = parseInt(hex.substring(0,2), 16);
        let g = parseInt(hex.substring(2,4), 16);
        let b = parseInt(hex.substring(4,6), 16);
        return 'rgba('+r+','+g+','+b+','+opacity/100+')';
    };
    var handlePoolEntry = function (time, pool) {
        if (!pool) {
            return {}
        } else {
            if (skipIndex < skipCap) {
                skipIndex++;
                return {
                    workers: {
                        x: time,
                        y: pool.workerCount
                    },
                    blocks: {
                        x: time,
                        y: pool.blocks.pending
                    }
                }
            }
            skipIndex = 0;
            return {
                workers: {
                    x: time,
                    y: pool.workerCount
                },
                hashrate: {
                    x: time,
                    y: pool.hashrate,
                    original: pool.hashrate,
                    ema: 0
                },
                blocks: {
                    x: time,
                    y: pool.blocks.pending
                }
            }
        }
    };
    var finalizeGraphDataBuild = function (data) {
        Object.keys(data.hashrate).forEach(function (pool) {
            emaProcess(data.hashrate[pool].data, 24)
        });
        Object.keys(data).forEach(function (i) {
            let item = data[i];
            let latest = data.latest[i];
            if (item && latest) {
                for (let e in item) {
                    if (Object.prototype.hasOwnProperty.call(item, e)) {
                        let entry = item[e];
                        if (entry) {
                            let last = entry.data[entry.data.length - 1];
                            if (last) {
                                latest.labels.push(e);
                                latest.data.push(last.y)
                            }
                        }
                    }
                }
            }
        });
        return data
    };
    var buildGraphData = function (data) {
        var store = {
            pools: [],
            workers: {},
            hashrate: {},
            blocks: {},
            latest: {
                workers: {
                    labels: [],
                    data: []
                },
                hashrate: {
                    labels: [],
                    data: []
                }
            }
        };
        for (let i = 0; i < data.length; i++) {
            let item = data[i];
            if (item) {
                let time = item.time * 1000;
                let pools = item.pools;
                if (pools) {
                    handlePools(store, time, pools)
                }
            }
        }
        return finalizeGraphDataBuild(store)
    };
    var handlePools = function (store, time, pools) {
        for (let p in pools) {
            if (Object.prototype.hasOwnProperty.call(pools, p)) {
                if (!store.pools.includes(p)) {
                    store.pools.push(p)
                }
                let pool = pools[p];
                let parsed = handlePoolEntry(time, pool);
                for (let e in parsed) {
                    let isWorkers = e === 'workers';
                    let root = store[e];
                    if (root) {
                        if (!root[p]) {
                            let index = Object.keys(root).length;
                            let color = chartColors[index % chartColors.length];
                            root[p] = {
                                label: p,
                                pointRadius: isWorkers ? 0 : 1,
                                steppedLine: isWorkers,
                                borderColor: color,
                                backgroundColor: getTransparentHex(color, 20),
                                data: []
                            }
                        }
                        root[p].data.push(parsed[e])
                    }
                }
            }
        }
    };
    var createLineChart = function (id, datasets, beginAtZero = !0, steps = 10, stepValue = 5, callback = function (value) {
        return value
    }) {
        var ctx = $(`#${id}`);
        return new Chart(ctx, {
            type: 'line',
            data: {
                datasets: datasets
            },
            options: {
                scales: {
                    yAxes: [{
                        gridLines: {
                            color: "rgba(100, 100, 100, 0.1)"
                        },
                        ticks: {
                            beginAtZero: beginAtZero,
                            steps: steps,
                            stepValue: stepValue,
                            callback: callback
                        }
                    }],
                    xAxes: [{
                        type: 'time',
                        distribution: 'series',
                        gridLines: {
                            display: !1
                        },
                        ticks: {
                            source: 'labels'
                        }
                    }]
                }
            }
        })
    }
    var createPieChart = function (id, data, reverseColors = !1, options = {}) {
        let ctx = $(`#${id}`);
        let colors = !reverseColors ? chartColors : chartColors.slice(0).reverse();
        return new Chart(ctx, {
            type: 'pie',
            data: {
                datasets: [{
                    label: 'Colors',
                    backgroundColor: colors,
                    borderColor: colors,
                    data: data.data
                }],
                labels: data.labels
            },
            options: options
        })
    }
    var isNewPoolAdded = function (pools) {
        if (pools) {
            for (let p in pools) {
                if (Object.prototype.hasOwnProperty.call(pools, p)) {
                    if (!graphData.pools.includes(p)) {
                        return !0
                    }
                }
            }
        }
        return !1
    }
    var handleData = function (data) {
        try {
            graphData = buildGraphData(data);
            charts.workers = createLineChart('worker-chart-global', Object.values(graphData.workers), !0, 5, 2, (value) => {
                if (value == 0) {
                    return value
                } else {
                    let floor = Math.floor(value);
                    return floor <= 0 ? '' : floor
                }
            });
            charts.hashrate = createLineChart('hashrate-chart-global', Object.values(graphData.hashrate), !0, 10, 5, (value) => {
                return getHashrateString(value)
            });
            charts.distWorkers = createPieChart('dist-worker-chart-global', graphData.latest.workers);
            charts.distHashrate = createPieChart('dist-hash-chart-global', graphData.latest.hashrate, !0, {
                tooltips: {
                    callbacks: {
                        label: function (tooltipItem, data) {
                            var indice = tooltipItem.index;
                            return data.labels[indice] + ': ' + getHashrateString(data.datasets[0].data[indice]) + ''
                        }
                    }
                }
            })
        } catch (e) {
            throw new Error(e)
        }
        return true;
    };
    $.getJSON('/api/pool_stats', function (data) {
        if (handleData(data)) {
            // todo
        } else {
            throw new Error('Something went wrong while loading statistics!')
        }
    });

    statsSource.addEventListener('message', function (e) {
        let response = JSON.parse(e.data);
        if (response) {
            let newPoolAdded = isNewPoolAdded(response.pools);
            let time = response.time * 1000;
            handlePools(graphData, time, response.pools);
            if (newPoolAdded) {
                if (handleData(response)) {
                    // todo
                } else {
                    throw new Error('Something went wrong while updating statistics!')
                }
            } else {
                Object.keys(graphData.hashrate).forEach(function (pool) {
                    emaProcess(graphData.hashrate[pool].data, 24)
                });
                for (let c in charts) {
                    if (Object.prototype.hasOwnProperty.call(charts, c)) {
                        let chart = charts[c];
                        if (chart) {
                            chart.update()
                        }
                    }
                }
            }
        }
    })
})