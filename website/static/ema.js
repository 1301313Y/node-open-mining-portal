var applyExponentialMovingAVG= function(dataObjArray, timePeriods = 12){
    var k = 2/(timePeriods + 1);
    // first item is just the same as the first item in the input
    dataObjArray[0].ema = dataObjArray[0].original;
    emaArray = [dataObjArray[0]];
    // for the rest of the items, they are computed with the previous one
    for (var i = 1; i < dataObjArray.length; i++) {
        let e = dataObjArray[i].original * k + emaArray[i - 1].ema * (1 - k);
        dataObjArray[i].ema = e;
        emaArray.push(dataObjArray[i]);
    }
    return dataObjArray;
};