let net = require("net");
let fs = require("fs");
let open = require("open");
let MTPpacket = require("./MTPRequest"),// uncomment this line after you run npm install command

singleton = require("./Singleton");

// call as GetImage -s <serverIP>:<port> -q <image name> -v <version>

// Enter your code for the client functionality here
// You should connect to the server and send the request packet
// You should receive the response packet from the server
// You should print the response packet in bits format
// You should extract the media data from the response packet
// You should save the image data to a file

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let result = {
        server: null,
        query: null,
        version: 11,
        type: 'query'
    };
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-s' && i + 1 < args.length) {
            result.server = args[++i];
        } else if (args[i] === '-q' && i + 1 < args.length) {
            result.query = args[++i];
        } else if (args[i] === '-v' && i + 1 < args.length) {
            result.version = parseInt(args[++i]);
        } else if (args[i] === '--type' && i + 1 < args.length) {
            result.type = args[++i];
        }
    }
    
    return result;
}

// Get media type from filename extension
function getMediaType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
        'bmp': 1, 'jpg': 2, 'jpeg': 2, 'tiff': 3, 'gif': 4,
        'png': 5, 'avi': 6, 'mp4': 7, 'mov': 8, 'raw': 15
    };
    return types[ext] || 1; // Default to BMP if unknown
}

// Main execution
const args = parseArgs();

if (!args.server || !args.query) {
    console.error('Usage: node GetMedia -s <serverIP:port> -q <media name> -v <version> --type <secret/query>');
    process.exit(1);
}

// Parse server address
const [host, port] = args.server.split(':');
if (!host || !port) {
    console.error('Invalid server address. Use format: ip:port');
    process.exit(1);
}

console.log(`Connected to MediaDB server on: ${host}:${port}`);

// Determine request type (1 = Query, 2 = Secret, 3 = ACK, 4 = Complete, 5 = Reset)
let requestType = 1; // Default Query
if (args.type === 'secret') requestType = 2;
else if (args.type === 'ack') requestType = 3;
else if (args.type === 'complete') requestType = 4;
else if (args.type === 'reset') requestType = 5;

// Extract filename without extension for the request
const fullFilename = args.query;
const baseFilename = fullFilename.includes('.') ? 
    fullFilename.substring(0, fullFilename.lastIndexOf('.')) : fullFilename;
const mediaType = getMediaType(fullFilename);

console.log(`Requesting: ${fullFilename} (base: ${baseFilename}, type: ${mediaType})`);
console.log(`Version: ${args.version}`);
console.log(`Request type: ${args.type} (${requestType})`);

// Initialize MTPpacket with request data
// init(version, requestType, timestamp, mediaType, filename)
const timestamp = Math.floor(Date.now() / 1000);
MTPpacket.init(requestType, timestamp, mediaType, baseFilename);

// Get the complete request packet
const requestPacket = MTPpacket.getBytePacket();

console.log('\nMTP request packet sent:');
printPacketBit(requestPacket);

// Connect to server
const client = net.createConnection(parseInt(port), host, () => {
    console.log('Connected to server, sending request...');
    client.write(requestPacket);
});

// Response handling
let responseBuffer = Buffer.alloc(0);
let responseHeader = null;
let fileData = Buffer.alloc(0);
let packetsReceived = 0;
let expectedPayloadSize = 0;

client.on('data', (data) => {
    console.log(`Received ${data.length} bytes from server`);

    console.log('First 20 bytes (hex):', data.slice(0,20).toString('hex'));
    console.log('First 20 bytes (ascii):', data.slice(0,20).toString('ascii'));
    
    responseBuffer = Buffer.concat([responseBuffer, data]);
    
    // Process all complete packets in buffer
    while (responseBuffer.length >= 12) {
        if (!responseHeader) {
            // Parse header
            responseHeader = parseResponseHeader(responseBuffer);
            
            console.log('\nMTP packet header received:');
            printPacketBit(responseBuffer.slice(0, 12));
            
            console.log('\nServer sent:');
            console.log(`--MTP version = ${responseHeader.version}`);
            console.log(`--Response Type = ${getResponseTypeName(responseHeader.responseType)}`);
            console.log(`--Sequence Number = ${responseHeader.sequenceNum}`);
            console.log(`--Last Flag = ${responseHeader.lastFlag}`);
            console.log(`--Payload Size = ${responseHeader.payloadSize} bytes`);
            
            expectedPayloadSize = responseHeader.payloadSize;
            
            // Remove header from buffer
            responseBuffer = responseBuffer.slice(12);
            
            // If no payload, packet is complete
            if (expectedPayloadSize === 0) {
                console.log('Empty payload (likely Not Found response)');
                responseHeader = null;
                packetsReceived++;
            }
        } else {
            // We're collecting payload
            const bytesNeeded = expectedPayloadSize - fileData.length;
            const bytesToTake = Math.min(bytesNeeded, responseBuffer.length);
            
            fileData = Buffer.concat([fileData, responseBuffer.slice(0, bytesToTake)]);
            responseBuffer = responseBuffer.slice(bytesToTake);
            
            // Check if we have complete payload
            if (fileData.length >= expectedPayloadSize) {
                console.log(`Complete packet ${packetsReceived} received (${fileData.length} bytes payload)`);
                
                // Save file data if this is the last packet
                if (responseHeader.lastFlag) {
                    saveAndOpenFile(fileData, fullFilename);
                } else {
                    // More packets coming, reset for next packet
                    console.log('More packets expected...');
                    fileData = Buffer.alloc(0);
                }
                
                responseHeader = null;
                packetsReceived++;
                
                // If this was the last packet, we might close
                if (responseHeader && responseHeader.lastFlag) {
                    break;
                }
            }
        }
    }
});

client.on('end', () => {
    console.log('\nDisconnected from the server');
    console.log('Connection closed');
});

client.on('error', (err) => {
    console.error('Client error:', err.message);
});

// Timeout after 10 seconds
setTimeout(() => {
    if (!responseHeader && fileData.length === 0) {
        console.log('\nTimeout: No response received');
        client.end();
    }
}, 10000);

// ============= HELPER FUNCTIONS =============

function parseResponseHeader(buffer) {
    if (buffer.length < 12) return null;
    
    // Version (5 bits) and Response Type (3 bits) from byte 0
    const version = (buffer[0] >> 3) & 0x1F;
    const responseType = buffer[0] & 0x07;
    
    // Sequence Number (24 bits) from bytes 1-3
    const sequenceNum = (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
    
    // Reserved (32 bits) from bytes 4-7
    const reserved = (buffer[4] << 24) | (buffer[5] << 16) | 
                     (buffer[6] << 8) | buffer[7];
    
    // Last flag (1 bit) and Payload Size (31 bits) from bytes 8-11
    const lastFlag = (buffer[8] >> 7) & 0x01;
    const payloadSize = ((buffer[8] & 0x7F) << 24) | 
                        (buffer[9] << 16) | 
                        (buffer[10] << 8) | 
                        buffer[11];
    
    return {
        version, responseType, sequenceNum, reserved, lastFlag, payloadSize
    };
}

function getResponseTypeName(type) {
    const types = ['Query', 'Found', 'Not Found', 'Busy'];
    return types[type] || 'Unknown';
}

function saveAndOpenFile(data, filename) {
    const outputFilename = `downloaded_${filename}`;
    
    fs.writeFileSync(outputFilename, data);
    console.log(`\n✅ File saved as: ${outputFilename} (${data.length} bytes)`);
    
    // Open with default viewer
    console.log('Opening with default viewer...');
    open(outputFilename);
}

//some helper functions
// return integer value of the extracted bits fragment
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
function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += String.fromCharCode(array[i]);
  }
  return result;
}

