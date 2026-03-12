const fs = require("fs");

function parseAmPmTime(timeStr) {
    let str = timeStr.trim().toLowerCase();
    let parts = str.split(" ");
    let timePart = parts[0];
    let period = parts[1];

    let timePieces = timePart.split(":");
    let hours = Number(timePieces[0]);
    let minutes = Number(timePieces[1]);
    let seconds = Number(timePieces[2]);

    if(period === "am"){
        if(hours===12)hours=0;
    }else{
        if(hours!==12)hours +=12;
    }

    return hours*3600+minutes*60+seconds;
}

function parseDuration(durationStr){
    let parts = durationStr.trim().split(":");
    let hours = Number(parts[0]);
    let minutes = Number(parts[1]);
    let seconds = Number(parts[2]);
    return hours*3600+minutes*60+seconds;
}

function formatDuration(totalSeconds){
    if (totalSeconds<0) totalSeconds= 0;

    let hours = Math.floor(totalSeconds/3600);
    let remaining = totalSeconds%3600;
    let minutes = Math.floor(remaining/60);
    let seconds = remaining%60;

    let minutesStr = minutes<10? "0" + minutes : "" + minutes;
    let secondsStr = seconds< 10? "0" + seconds : "" + seconds;

    return hours + ":" + minutesStr + ":" + secondsStr;
}

function getMonthNumber(dateStr){
    return Number(dateStr.split("-")[1]);
}

function isEidPeriod(date){
    return date>="2025-04-10" && date<="2025-04-30";
}

function getQuotaSeconds(date){
    if (isEidPeriod(date)) return 6*3600;
    return 8*3600+24*60;
}

function readShiftFile(textFile){
    let content = fs.readFileSync(textFile,{ encoding: "utf8" }).trim();
    if(content === ""){
        return{
            header:"DriverID,DriverName,Date,StartTime,EndTime,ShiftDuration,IdleTime,ActiveTime,MetQuota,HasBonus",
            records:[]
        };
    }

    let lines = content.split("\n").filter(line => line.trim() !== "");
    let header = lines[0].trim();
    let records = [];

    for (let i = 1; i < lines.length; i++){
        let parts = lines[i].trim().split(",");
        records.push({
            driverID: parts[0],
            driverName: parts[1],
            date: parts[2],
            startTime: parts[3],
            endTime: parts[4],
            shiftDuration: parts[5],
            idleTime: parts[6],
            activeTime: parts[7],
            metQuota: parts[8] === "true",
            hasBonus: parts[9] === "true"
        });
    }

    return { header, records };
}

function writeShiftFile(textFile, header, records){
    let lines = [header];

    for (let i = 0; i < records.length; i++){
        let r = records[i];
        lines.push([
            r.driverID,
            r.driverName,
            r.date,
            r.startTime,
            r.endTime,
            r.shiftDuration,
            r.idleTime,
            r.activeTime,
            String(r.metQuota),
            String(r.hasBonus)
        ].join(","));
    }

    fs.writeFileSync(textFile, lines.join("\n"), { encoding: "utf8" });
}

function readRateFile(rateFile){
    let content = fs.readFileSync(rateFile, { encoding: "utf8" }).trim();
    if (content === "") return [];

    let lines = content.split("\n").filter(line => line.trim() !== "");
    let records = [];

    for (let i = 0; i < lines.length; i++){
        let parts = lines[i].trim().split(",");
        records.push({
            driverID: parts[0],
            dayOff: parts[1],
            basePay: Number(parts[2]),
            tier: Number(parts[3])
        });
    }

    return records;
}

function getDayName(dateStr){
    let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let date = new Date(dateStr + "T00:00:00");
    return days[date.getDay()];
}


// Function 1: getShiftDuration

function getShiftDuration(startTime, endTime){
    let startSeconds = parseAmPmTime(startTime);
    let endSeconds = parseAmPmTime(endTime);

    if (endSeconds < startSeconds) {
        endSeconds += 24 * 3600;
    }

    return formatDuration(endSeconds - startSeconds);
}

// Function 2: getIdleTime

function getIdleTime(startTime, endTime){
    let startSeconds = parseAmPmTime(startTime);
    let endSeconds = parseAmPmTime(endTime);

    if (endSeconds < startSeconds){
        endSeconds += 24*3600;
    }

    let totalShift = endSeconds - startSeconds;

    let allowedIntervals = [
        [8 * 3600, 22 * 3600],
        [24 * 3600 + 8 * 3600, 24 * 3600 + 22 * 3600]
    ];

    let activeWithinDeliveryHours = 0;

    for (let i = 0; i < allowedIntervals.length; i++){
        let intervalStart = allowedIntervals[i][0];
        let intervalEnd = allowedIntervals[i][1];

        let overlapStart = Math.max(startSeconds, intervalStart);
        let overlapEnd = Math.min(endSeconds, intervalEnd);

        if (overlapEnd > overlapStart){
            activeWithinDeliveryHours += overlapEnd - overlapStart;
        }
    }

    let idleSeconds = totalShift - activeWithinDeliveryHours;
    return formatDuration(idleSeconds);
}


// Function 3: getActiveTime

function getActiveTime(shiftDuration, idleTime) {
    let shiftSeconds = parseDuration(shiftDuration);
    let idleSeconds = parseDuration(idleTime);
    return formatDuration(shiftSeconds - idleSeconds);
}

// Function 4: metQuota(date, activeTime)

function metQuota(date, activeTime){
    let activeSeconds = parseDuration(activeTime);
    let requiredSeconds = getQuotaSeconds(date);
    return activeSeconds >= requiredSeconds;
}


// Function 5: addShiftRecord

function addShiftRecord(textFile, shiftObj){
    let fileData = readShiftFile(textFile);
    let header = fileData.header;
    let records = fileData.records;

    for (let i = 0; i < records.length; i++) {
        if (records[i].driverID === shiftObj.driverID && records[i].date === shiftObj.date) {
            return {};
        }
    }

    let shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    let idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    let activeTime = getActiveTime(shiftDuration, idleTime);
    let quotaMet = metQuota(shiftObj.date, activeTime);

    let newRecord = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration: shiftDuration,
        idleTime: idleTime,
        activeTime: activeTime,
        metQuota: quotaMet,
        hasBonus: false
    };

    let insertIndex = -1;

    for (let i = 0; i < records.length; i++){
        if (records[i].driverID === shiftObj.driverID) {
            insertIndex = i;
        }
    }

    if (insertIndex === -1){
        records.push(newRecord);
    } else {
        records.splice(insertIndex + 1, 0, newRecord);
    }

    writeShiftFile(textFile, header, records);
    return newRecord;
}


// Function 6: setBonus

function setBonus(textFile, driverID, date, newValue){
    let fileData = readShiftFile(textFile);
    let header = fileData.header;
    let records = fileData.records;

    for (let i = 0; i < records.length; i++){
        if (records[i].driverID === driverID && records[i].date === date) {
            records[i].hasBonus = newValue;
            break;
        }
    }

    writeShiftFile(textFile, header, records);
}


// Function 7: countBonusPerMonth

function countBonusPerMonth(textFile, driverID, month){
    let fileData = readShiftFile(textFile);
    let records = fileData.records;
    let monthNumber = Number(month);

    let driverExists = false;
    let count = 0;

    for(let i = 0; i < records.length; i++){
        if(records[i].driverID === driverID){
            driverExists = true;

            if(getMonthNumber(records[i].date) === monthNumber && records[i].hasBonus === true) {
                count++;
            }
        }
    }

    if (!driverExists) return -1;
    return count;
}


// Function 8: getTotalActiveHoursPerMonth

function getTotalActiveHoursPerMonth(textFile, driverID, month){
    let fileData = readShiftFile(textFile);
    let records = fileData.records;

    let totalSeconds = 0;

    for(let i = 0; i < records.length; i++){
        if(records[i].driverID === driverID && getMonthNumber(records[i].date) === Number(month)){
            totalSeconds += parseDuration(records[i].activeTime);
        }
    }

    return formatDuration(totalSeconds);
}


// Function 9: getRequiredHoursPerMonth

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month){
    let fileData = readShiftFile(textFile);
    let records = fileData.records;
    let rateRecords = readRateFile(rateFile);

    let driverRate = null;
    for (let i = 0; i < rateRecords.length; i++){
        if(rateRecords[i].driverID === driverID){
            driverRate = rateRecords[i];
            break;
        }
    }

    if(driverRate === null){
        return "0:00:00";
    }

    let totalRequiredSeconds = 0;

    for(let i = 0; i < records.length; i++){
        let record = records[i];

        if(record.driverID === driverID && getMonthNumber(record.date) === Number(month)){
            let dayName = getDayName(record.date);

            if (dayName !== driverRate.dayOff){
                totalRequiredSeconds += getQuotaSeconds(record.date);
            }
        }
    }

    totalRequiredSeconds -= bonusCount *2*3600;

    if(totalRequiredSeconds < 0){
        totalRequiredSeconds = 0;
    }

    return formatDuration(totalRequiredSeconds);
}


// Function 10: getNetPay

function getNetPay(driverID, actualHours, requiredHours, rateFile){
    let rateRecords = readRateFile(rateFile);

    let driverRate = null;
    for (let i = 0; i < rateRecords.length; i++){
        if(rateRecords[i].driverID === driverID){
            driverRate = rateRecords[i];
            break;
        }
    }

    if (driverRate === null) return 0;

    let actualSeconds = parseDuration(actualHours);
    let requiredSeconds = parseDuration(requiredHours);

    if (actualSeconds >= requiredSeconds){
        return driverRate.basePay;
    }

    let missingSeconds = requiredSeconds - actualSeconds;

    let allowedHours = 0;
    if (driverRate.tier === 1) allowedHours = 50;
    else if (driverRate.tier === 2) allowedHours = 20;
    else if (driverRate.tier === 3) allowedHours = 10;
    else if (driverRate.tier === 4) allowedHours = 3;

    let adjustedMissingSeconds = missingSeconds - allowedHours*3600;

    if (adjustedMissingSeconds <= 0){
        return driverRate.basePay;
    }

    let billableMissingHours = Math.floor(adjustedMissingSeconds/3600);
    let deductionRatePerHour = Math.floor(driverRate.basePay/185);
    let salaryDeduction = billableMissingHours*deductionRatePerHour;
    let netPay = driverRate.basePay - salaryDeduction;

    return netPay;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
