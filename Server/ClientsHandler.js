var MTPpacket = require("./MTPResponse"),
singleton = require("./Singleton");

// You need to add some statements here
// Since header is 12 bytes
const HEADER_SIZE = 12;


module.exports = {
  handleClientJoining: function (sock) {
    console.log(`Client ${sock.remotePort} connected`);

    // Per-client buffer (accumulates incoming data)
    let clientBuffer = Buffer.alloc(0);
    
    sock.on('data', (data) => {
        // Add new data to buffer
        clientBuffer = Buffer.concat([clientBuffer, data]);
        
        // Process all complete requests in buffer
        processClientData(sock, clientBuffer);
    });
    
    sock.on('close', () => {
        handleClientLeaving(sock);
    });
    
    sock.on('error', (err) => {
        console.log(`Client ${sock.remotePort} error: ${err.message}`);
    });
  }

};

function handleClientLeaving(sock) {
  console.log(`Client ${sock.remotePort} closed connection`);
}

function processClientData(sock, buffer) {
    // Need at least 12 bytes for header
    while (buffer.length >= HEADER_SIZE) {

        // Should always be 11
        const version = parseBitPacket(buffer, 0, 5);
        
        // Reserved (24 bits) - not used for basic query
        const reserved = (parseBitPacket(buffer, 5, 8) << 16) |
                         (parseBitPacket(buffer, 13, 8) << 8) |
                         parseBitPacket(buffer, 21, 8);

        const requestType = parseBitPacket(buffer, 29, 3);
        
        // Timestamp (32 bits)
        const timestamp = (parseBitPacket(buffer, 32, 8) << 24) |
                          (parseBitPacket(buffer, 40, 8) << 16) |
                          (parseBitPacket(buffer, 48, 8) << 8) |
                          parseBitPacket(buffer, 56, 8);
        
        // Media Type (4 bits)
        const mediaType = parseBitPacket(buffer, 64, 4);
        
        // Filename Size (28 bits)
        const filenameSize = (parseBitPacket(buffer, 68, 4) << 24) |
                             (parseBitPacket(buffer, 72, 8) << 16) |
                             (parseBitPacket(buffer, 80, 8) << 8) |
                             parseBitPacket(buffer, 88, 8);
        
        // Check if we have the full filename
        if (buffer.length < HEADER_SIZE + filenameSize) {
            return;  // Wait for more data
        }
        
        // Extract filename
        const filenameBuffer = buffer.slice(HEADER_SIZE, HEADER_SIZE + filenameSize);
        const filename = bytesToString(filenameBuffer);
        
        // Log the request (as required by assignment)
        console.log(`\nClient-${sock.remotePort} requests:`);
        console.log(`- MTP version: ${version}`);
        console.log(`- Request type: ${getRequestTypeName(requestType)}`);
        console.log(`- Media file name: ${filename}`);
        
        // Print packet in bits format (required)
        console.log('MTP packet received:');
        printPacketBit(buffer.slice(0, HEADER_SIZE + filenameSize));
        
        // Remove processed data from buffer
        // This modifies the original buffer by reference
        buffer = buffer.slice(HEADER_SIZE + filenameSize);
        
        // Handle based on request type
        // For now, only handle Query (type 1)
        if (requestType === 1) {
            handleQuery(sock, filename);
        } else {
            console.log(`Ignoring request type ${requestType} - only Query supported`);
            // Optionally send error response
            sendNotFound(sock);
        }
    }
}

// Helper to convert request type number to name
function getRequestTypeName(type) {
    const types = ['?', 'Query', 'Secret', 'ACK', 'Complete', 'Reset'];
    return types[type] || 'Unknown';
}

// ============= QUERY HANDLING =============
function handleQuery(sock, filename) {
    console.log(`Handling Query for file: ${filename}`);
    
    // Check if file exists
    fs.access(filename, fs.constants.F_OK, (err) => {
        if (err) {
            console.log(`File ${filename} not found`);
            sendNotFound(sock);
        } else {
            console.log(`File ${filename} found, sending...`);
            sendFile(sock, filename);
        }
    });
}

function sendNotFound(sock) {
    // Get next sequence number from singleton
    let seqNum = singleton.getSequenceNumber();
    
    // Create "Not Found" response (type=2) with empty payload
    MTPpacket.init(11, 2, seqNum, 0, 1, Buffer.alloc(0));
    
    // Get the complete packet and send
    let packet = MTPpacket.getBytePacket();
    sock.write(packet);
    
    console.log(`Sent Not Found to client (sequence ${seqNum})`);
    
    // Optional: print packet for debugging
    // MTPpacket.printPacket();
}

function sendFile(sock, filename) {
    // Read the file
    fs.readFile(filename, (err, data) => {
        if (err) {
            console.log(`Error reading file: ${err.message}`);
            sendNotFound(sock);
            return;
        }
        
        // Check if file is small enough for one packet
        // For now, assume single packet (we'll add multi-packet later)
        
        // Get next sequence number from singleton
        let seqNum = singleton.getSequenceNumber();
        
        // Create "Found" response (type=1) with file data as payload
        MTPpacket.init(11, 1, seqNum, 0, 1, data);
        
        // Get packet and send
        let packet = MTPpacket.getBytePacket();
        sock.write(packet);
        
        console.log(`Sent file ${filename} (sequence ${seqNum}, ${data.length} bytes)`);
        
        // Optional: print packet for debugging
        // MTPpacket.printPacket();
    });
}

function bytesToString(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

function bytes2number(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result ^= array[array.length - i - 1] << (8 * i);
  }
  return result;
}

// return integer value of a subset bits
function parseBitPacket(packet, offset, length) {
  let number = "";
  for (var i = 0; i < length; i++) {
    // let us get the actual byte position of the offset
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
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
