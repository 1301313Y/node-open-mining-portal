var simpleMovingAVG = function(dataObjArray, timePeriods){
	var sum = 0;
	var result = false;

	try{
		for(var i=timePeriods-1;i>-1;i--){
			sum += dataObjArray[i].y;
		}

		result = (parseFloat(sum) / parseFloat(timePeriods));
		//console.log('SMA Result : ' + result);
	} catch(err) {
		result = false;
		console.log("SMA Error : " + err);
	}

	return result;
};