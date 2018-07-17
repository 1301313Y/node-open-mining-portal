var skipCap = 5; // 5 mins as data is collected every 60 seconds
var skipIndex = 5; //include first entry

var poolWorkerData;
var poolHashrateData;
var poolBlockData;
var poolTimeData;
var workerDistData;
var hashDistData;

var poolWorkerChart;
var workerDistChart;
var hashDistChart;
var poolHashrateChart;
var poolBlockChart;

var statData;
var poolKeys;
var maxUser = 0;

function buildChartData(){

    var pools = {};

    poolKeys = [];
    poolTimeData = [];
    workerDistData = {
        labels: [],
        data: []
    };
    hashDistData = {
        labels: [],
        data: []
    };
    for (var i = 0; i < statData.length; i++){
        for (var pool in statData[i].pools){
            if (poolKeys.indexOf(pool) === -1)
                poolKeys.push(pool);
        }
    }


    for (var i = 0; i < statData.length; i++){

        var time = statData[i].time * 1000;
        poolTimeData.push(time);
        for (var f = 0; f < poolKeys.length; f++){
            if(skipIndex < skipCap){
                skipIndex++;
                continue;
            }
            skipIndex = 0;
            var pName = poolKeys[f];
            var a = pools[pName] = (pools[pName] || {
                hashrate: [],
                workers: [],
                blocks: []
            });
            if (pName in statData[i].pools){
                a.hashrate.push({ x: time, y: statData[i].pools[pName].hashrate, original: statData[i].pools[pName].hashrate, ema: 0 });
                a.workers.push({ x: time, y: statData[i].pools[pName].workerCount });
                a.blocks.push({ x: time, y: statData[i].pools[pName].blocks.pending });
                handleMaxUser(statData[i].pools[pName].workerCount);
            }
            else{
                a.hashrate.push({ x: time, y: 0 });
                a.workers.push({ x: time, y: 0 });
                a.blocks.push({ x: time, y: 0 });
            }

        }

    }

    poolWorkerData = [];
    poolHashrateData = [];
    poolBlockData = [];


    for (var pool in pools){
        let workers = pools[pool].workers;
        workerDistData.labels.push(pool);
        let index = poolWorkerData.length;
        let color = chartColors[index % chartColors.length];
        workerDistData.data.push(workers[workers.length - 1].y); // get last worker entry
        poolWorkerData.push({
            label: pool,
            pointRadius: 0,
            steppedLine: true,
            borderColor: color,
            backgroundColor: convertHex(color, 20),
            data: workers
        });
        let hashrate = pools[pool].hashrate;
        hashDistData.labels.push(pool);
        hashDistData.data.push(hashrate[hashrate.length - 1].y); // get last hashrate entry
        applyExponentialMovingAVG(hashrate, 24);
        poolHashrateData.push({
            label: pool,
            pointRadius: 0,
            borderColor: color,
            data: hashrate
        });
        poolBlockData.push({
            label: pool,
            backgroundColor: 'rgb(255, 99, 132)',
            borderColor: 'rgb(255, 99, 132)',
            data: pools[pool].blocks
        })
    }
}

function handleMaxUser(count) {
    if(count > maxUser) {
        maxUser = count;
    }
}

function getReadableHashRateString(hashrate){
    var i = -1;
    var byteUnits = [ ' KH/s', ' MH/s', ' GH/s', ' TH/s', ' PH/s' ];
    do {
        hashrate = hashrate / 1024;
        i++;
    } while (hashrate > 1024);
    return Math.round(hashrate) + byteUnits[i];
}

function timeOfDayFormat(timestamp){
    var dStr = d3.time.format('%I:%M %p')(new Date(timestamp));
    if (dStr.indexOf('0') === 0) dStr = dStr.slice(1);
    return dStr;
}

function displayWorkerChart(){
    var ctx = $('#worker-chart-global');
    poolWorkerChart = new Chart(ctx, {
        // The type of chart we want to create
        type: 'line',
        data: {
            datasets: poolWorkerData
        },
        // Configuration options go here
        options: {
            scales: {
                yAxes: [{
                    beginAtZero: true,
                    gridLines: {
                        color: "rgba(100, 100, 100, 0.1)"
                    },
                    ticks: {
                        beginAtZero: true,
                        steps: 10,
                        stepValue: 5,
                        max: Math.floor(-((0.01 * maxUser) - 10))
                    }
                }],
                xAxes: [{
                    type: 'time',
                    distribution: 'series',
                    gridLines: {
                        display: false
                    },
                    ticks: {
                        source: 'labels'
                    }
                }]
            }
        }
    });
    // use configuration item and data specified to show chart
    //poolWorkerChart = new Chartist.Bar('#worker-chart-global', dataCompletedTasksChart, optionsCompletedTasksChart);
    //md.startAnimationForBarChart(poolWorkerChart);
}

function displayHashrateChart(){
    var ctx = $('#hashrate-chart-global');
    poolHashrateChart = new Chart(ctx, {
        // The type of chart we want to create
        type: 'line',
        data: {
            datasets: poolHashrateData.map((i) => {
                return { 
                    label: i.label,
                    data: i.data.map((e) => { return { x: e.x, y: e.ema }; }),
                    pointRadius: i.pointRadius,
                    borderColor: i.borderColor,
                    backgroundColor: i.backgroundColor,
                }; 
            })
        },
        // Configuration options go here
        options: {
            tooltips: {
                callbacks: {
                    title: function(tooltipItem, data) {
                        return Date(tooltipItem).toLocaleString();
                    },
                    label: function(tooltipItem, data) {
                        return formatHashrate(tooltipItem.yLabel);
                    }
                }
            },
            scales: {
                yAxes: [{
                    beginAtZero: true,
                    gridLines: {
                        color: "rgba(100, 100, 100, 0.1)"
                    },
                    ticks: {
                        beginAtZero: true,
                        steps: 10,
                        stepValue: 5,
                        callback: function(value, index, values) {
                            return formatHashrate(value);
                        }
                    },
                }],
                xAxes: [{
                    type: 'time',
                    distribution: 'series',
                    gridLines: {
                        display: false
                    },
                    ticks: {
                        source: 'data'
                    }
                }]
            }
        }
    });
    // use configuration item and data specified to show chart
    //poolWorkerChart = new Chartist.Bar('#worker-chart-global', dataCompletedTasksChart, optionsCompletedTasksChart);
    //md.startAnimationForBarChart(poolWorkerChart);
}

function displayWorkDistChart(){
    let ctx = $('#pool-chart-global');

    workerDistChart = new Chart(ctx, {
        // The type of chart we want to create
        type: 'pie',
        data: {
            datasets: [{
                label: 'Colors',
                backgroundColor: chartColors,
                borderColor: chartColors,
                data: workerDistData.data
            }],
        
            // These labels appear in the legend and in the tooltips when hovering different arcs
            labels: workerDistData.labels
        },
        // Configuration options go here
        options: {
         
        }
    });
    // use configuration item and data specified to show chart
    //poolWorkerChart = new Chartist.Bar('#worker-chart-global', dataCompletedTasksChart, optionsCompletedTasksChart);
    //md.startAnimationForBarChart(poolWorkerChart);
}

function displayHashDistChart(){
    let ctx = $('#dist-hash-chart-global');
    let colors = chartColors.slice(0).reverse();
    hashDistChart = new Chart(ctx, {
        // The type of chart we want to create
        type: 'pie',
        data: {
            datasets: [{
                label: 'Colors',
                backgroundColor: colors,
                borderColor: colors,
                data: hashDistData.data
            }],
        
            // These labels appear in the legend and in the tooltips when hovering different arcs
            labels: hashDistData.labels
        },
        // Configuration options go here
        options: {
            tooltips: {
                callbacks: {
                    label: function(tooltipItem, data) { 
                        var indice = tooltipItem.index;                 
                        return  data.labels[indice] +': '+ formatHashrate(data.datasets[0].data[indice]) + '';
                    }
                }
            }
        }
    });
    // use configuration item and data specified to show chart
    //poolWorkerChart = new Chartist.Bar('#worker-chart-global', dataCompletedTasksChart, optionsCompletedTasksChart);
    //md.startAnimationForBarChart(poolWorkerChart);
}

function triggerChartUpdates(){
    poolWorkerChart.update();
    hashDistChart.update();
    poolHashrateChart.update();
    //poolBlockChart.update();
}

nv.utils.windowResize(triggerChartUpdates);

$.getJSON('/api/pool_stats', function(data){
    statData = data;
    buildChartData();
    displayWorkerChart();
    displayWorkDistChart();
    displayHashDistChart();
    displayHashrateChart();
});

statsSource.addEventListener('message', function(e){
    var stats = JSON.parse(e.data);
    statData.push(stats);


    var newPoolAdded = (function(){
        for (var p in stats.pools){
            if (poolKeys.indexOf(p) === -1)
                return true;
        }
        return false;
    })();

    if (newPoolAdded || Object.keys(stats.pools).length > poolKeys.length){
        buildChartData();
        displayWorkerChart();
    }
    else {
        if(skipIndex < skipCap){
            skipIndex++;
            return;
        }
        skipIndex = 0;
        var time = stats.time * 1000;
        for (var f = 0; f < poolKeys.length; f++) {
            var pool =  poolKeys[f];
            for (var i = 0; i < poolWorkerData.length; i++) {
                if (poolWorkerData[i].key === pool) {
                    poolWorkerData[i].values.shift();
                    poolWorkerChart.data.datasets[i].data.shift();
                    let entry = { x: time, y: stats.pools.includes(pool) ? stats.pools[pool].workerCount : 0 };
                    poolWorkerData[i].values.push(entry);
                    poolWorkerChart.data.datasets[i].data.push(entry);
                    break;
                }
            }
            for (var i = 0; i < poolHashrateData.length; i++) {
                if (poolHashrateData[i].key === pool) {
                    poolHashrateData[i].values.shift();
                    poolHashrateData[i].values.push({ x: time, y: stats.pools.includes(pool) ? stats.pools[pool].hashrate : 0 });
                    break;
                }
            }
            for (var i = 0; i < poolBlockData.length; i++) {
                if (poolBlockData[i].key === pool) {
                    poolBlockData[i].values.shift();
                    poolBlockData[i].values.push({ x: time, y: stats.pools.includes(pool) ? stats.pools[pool].blocks.pending : 0 });
                    break;
                }
            }
        }
        triggerChartUpdates();
    }


});