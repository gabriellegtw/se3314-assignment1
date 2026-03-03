// Some code need to be added here, that are common for the module
let seq_num = 0;
let timer = Date.now()


module.exports = {
    init: function () {
        seq_num = 0;
        console.log("seq_num intiialised");
    },

    //--------------------------
    //getSequenceNumber: return the current sequence number + 1
    //--------------------------
    getSequenceNumber: function () {
        return seq_num++;
    },

    //--------------------------
    //getTimestamp: return the current timer value
    //--------------------------
    getTimestamp: function () {
        return timer;
    }
}

    