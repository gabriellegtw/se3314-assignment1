// You may need to add some statements here
const HEADER_SIZE = 12;

module.exports = {
  // You may need to add some statements here
  version: 11,
  requestType: 1,
  timestamp: 0,
  mediaType: 1,
  filename: '',
  payload: null,
  requestHeader: null,

  init: function (reqType, timestamp, mediaType, filename) {
   // You  need to add some statements here
    this.version = 11;
    this.requestType = reqType;
    this.timestamp = timestamp;
    this.mediaType = mediaType;
    this.filename = filename;
    
    // Convert filename to bytes for payload
    this.payload = Buffer.from(filename);
    
    // Create fresh header buffer (all zeros)
    this.requestHeader = Buffer.alloc(HEADER_SIZE);
    
    // Build the header by setting each bit field
    this.buildHeader();
    
    return this;
  },
    // Build the 12-byte header
  buildHeader: function() {
    // Reset header to zeros
    this.requestHeader = Buffer.alloc(HEADER_SIZE);
    
    // Byte 0: Version (5 bits) + Reserved (first 3 bits)
    storeBitPacket(this.requestHeader, this.version, 0, 5);
    storeBitPacket(this.requestHeader, 0, 5, 3); // First 3 bits of Reserved = 0
    
    // Bytes 1-2: Next 16 bits of Reserved (set to 0)
    storeBitPacket(this.requestHeader, 0, 8, 16);
    
    // Byte 3: Last 5 bits of Reserved + Request Type (3 bits)
    storeBitPacket(this.requestHeader, 0, 24, 5); // Last 5 bits of Reserved = 0
    storeBitPacket(this.requestHeader, this.requestType, 29, 3);
    
    // Bytes 4-7: Timestamp (32 bits)
    storeBitPacket(this.requestHeader, (this.timestamp >> 24) & 0xFF, 32, 8);
    storeBitPacket(this.requestHeader, (this.timestamp >> 16) & 0xFF, 40, 8);
    storeBitPacket(this.requestHeader, (this.timestamp >> 8) & 0xFF, 48, 8);
    storeBitPacket(this.requestHeader, this.timestamp & 0xFF, 56, 8);
    
    // Byte 8: Media Type (4 bits) + Filename Size (first 4 bits)
    const filenameSize = this.filename.length;
    storeBitPacket(this.requestHeader, this.mediaType, 64, 4);
    storeBitPacket(this.requestHeader, (filenameSize >> 24) & 0x0F, 68, 4);
    
    // Bytes 9-11: Filename Size (remaining 24 bits)
    storeBitPacket(this.requestHeader, (filenameSize >> 16) & 0xFF, 72, 8);
    storeBitPacket(this.requestHeader, (filenameSize >> 8) & 0xFF, 80, 8);
    storeBitPacket(this.requestHeader, filenameSize & 0xFF, 88, 8);
  },

  //--------------------------
  //getBytePacket: returns the entire packet in bytes
  //--------------------------
  getBytePacket: function () {
    let packet = new Buffer.alloc(this.payload.length + HEADER_SIZE);
    //construct the packet = header + payload
    for (var Hi = 0; Hi < HEADER_SIZE; Hi++) packet[Hi] = this.requestHeader[Hi];
    for (var Pi = 0; Pi < this.payload.length; Pi++)
      packet[Pi + HEADER_SIZE] = this.payload[Pi];

    return packet;
  },
};

function stringToBytes(str) {
  var ch,
    st,
    re = [];
  for (var i = 0; i < str.length; i++) {
    ch = str.charCodeAt(i); // get char
    st = []; // set up "stack"
    do {
      st.push(ch & 0xff); // push byte to stack
      ch = ch >> 8; // shift value down by 1 byte
    } while (ch);
    // add stack contents to result
    // done because chars have "wrong" endianness
    re = re.concat(st.reverse());
  }
  // return an array of bytes
  return re;
}

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
