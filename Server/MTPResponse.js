// You may need to add some statements here
const HEADER_SIZE = 12;

module.exports = {

  //Add some statements as needed here
  version: 11,
  responseType: 0,
  sequenceNum: 0,
  reserved: 0,
  lastFlag: 0,
  payloadSize: 0,
  payload: null,
  responseHeader: null,

  // intialise the fields in the packet
  init: function (res_type, seq_num, reserved, flag, data){
    this.responseType = res_type;
    this.sequenceNum = seq_num;
    this.reserved = reserved;
    this.lastFlag = flag;
    this.payload = data;
    this.payloadSize = data.length;
    this.responseHeader = Buffer.alloc(HEADER_SIZE);
  },
  // Build the 12-byte header
  buildHeader: function() {
      // populate version
      storeBitPacket(this.responseHeader, this.version, 0, 5);
      
      // populate response
      storeBitPacket(this.responseHeader, this.responseType, 5, 3);
      
      // populate sequence number 8 bytes at a time
      // first 8 bits
      storeBitPacket(this.responseHeader, (this.sequenceNum >> 16) & 0xFF, 8, 8);
      // second 8 bits
      storeBitPacket(this.responseHeader, (this.sequenceNum >> 8) & 0xFF, 16, 8);
      // last 8 bits
      storeBitPacket(this.responseHeader, this.sequenceNum & 0xFF, 24, 8);
      
      // populate reserved
      storeBitPacket(this.responseHeader, (this.reserved >> 24) & 0xFF, 32, 8);
      storeBitPacket(this.responseHeader, (this.reserved >> 16) & 0xFF, 40, 8);
      storeBitPacket(this.responseHeader, (this.reserved >> 8) & 0xFF, 48, 8);
      storeBitPacket(this.responseHeader, this.reserved & 0xFF, 56, 8);
      
      // populate flag
      storeBitPacket(this.responseHeader, this.lastFlag, 64, 1);
      
      // populate payload size
      storeBitPacket(this.responseHeader, this.payloadSize, 65, 31);
  },
  //--------------------------
  //getBytePacket: returns the entire packet in bytes
  //--------------------------
  getBytePacket: function () {
    // Buffer is what is actually being sent via socket
    let packet = new Buffer.alloc(this.payloadSize + HEADER_SIZE);
    //construct the packet = header + payload
    for (var Hi = 0; Hi < HEADER_SIZE; Hi++)
      packet[Hi] = this.responseHeader[Hi];
    for (var Pi = 0; Pi < this.payloadSize; Pi++)
      packet[Pi + HEADER_SIZE] = this.payload[Pi];

    return packet;
  },
};

// Store integer value into the packet bit stream
function storeBitPacket(packet, value, offset, length) {
  // let us get the actual byte position of the offset
  let lastBitPosition = offset + length - 1;
  let number = value.toString(2);
  let j = number.length - 1;
  for (var i = 0; i < number.length; i++) {
    let bytePosition = Math.floor(lastBitPosition / 8);
    let bitPosition = 7 - (lastBitPosition % 8);
    if (number.charAt(j--) == "0") {
      packet[bytePosition] &= ~(1 << bitPosition);
    } else {
      packet[bytePosition] |= 1 << bitPosition;
    }
    lastBitPosition--;
  }
}
// Prints the entire packet in bits format
function printPacketBit(packet) {
  var bitString = "";

  for (var i = 0; i < packet.length; i++) {
    // To add leading zeros
    var b = "00000000" + packet[i].toString(2);
    // To print 4 bytes per line
    if (i > 0 && i % 4 == 0) bitString += "\n";
    bitString += " " + b.substr(b.length - 8);
  }
  console.log(bitString);
}

