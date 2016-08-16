//Trace the transaction to verify that the Extra balance is the same
//requires underscore so download it from loadScript("https://raw.githubusercontent.com/jashkenas/underscore/master/underscore-min.js") and modify the pathToLibs to point to the directory where you have the library
// or install it globally with    $ npm install -g underscore       which doesn't require you to modify the pathToLibs
var pathToLibs = "/usr/local/lib/node_modules"    //"/Users/b/Documents/01_Works/20160721_EthereumDaoExtraBalanceOwners/node_modules"
loadScript(pathToLibs + "/underscore/underscore-min.js");

var dbug = true; //trace to console - for testing purposes
   

/* conveniente wrapper to define if it is out of gas or not
* it can accept the string of the transaction hash OR directly the trace object
*
* //testing with a string  0x07a3d34f3618d4aa042b60f41bff8bb12192540538a179626e31fa27ecf164a1
* var test1 = isOutOfGas("0x07a3d34f3618d4aa042b60f41bff8bb12192540538a179626e31fa27ecf164a1")
* console.log("test1 - string: " + test1) 
* 
* //testing with a Tx Traced
* var txTrace = debug.traceTransaction("0x07a3d34f3618d4aa042b60f41bff8bb12192540538a179626e31fa27ecf164a1")
* var test2 = isOutOfGas(txTrace); 
* console.log("test2 - object: " + test2)
*/
function isOutOfGas(tx) {
	//console.log("typeof tx " + typeof(tx))
	var sl;
	if (typeof(tx) == "string") {
		//it' a string - then you need to trace the transaction
		var txTrace = debug.traceTransaction(tx);
		sl = txTrace.structLogs
	
	} else if (typeof(tx) == "object" && tx.structLogs != undefined) {
		//it already a trace transaction - simply check the last 
		sl = tx.structLogs
	}
	var lastLog = sl[ sl.length -1 ];
	var test =  (lastLog.error == "Out of gas")
	//console.log("tx " + tx + " is OUT OF GAS " + test);
	return test
}


/**
* extractExtraBalanceFromTXTrace -
* utility function to separate the values sent to the extra balance in 2 different cases
* it it's a direct transaction (ie sent from the end user's wallet to the Dao) -
* if it's a proxied transfer (ie sent from Poloniex in the name of another user) - in which case also extracts the address of the final user
* @param tx   - String - expects the string version of the Transaction reference ie "0x54f7088d06eedf39c037f92d697e16784df77708066578855e9d715685d73f2c"
*/
function extractExtraBalanceFromTXTrace(tx){
    if (dbug) console.log("be patient, this might take a few seconds - tracing transaction: " + tx);
	console.log(" isOutOfGas: " + isOutOfGas );
    var txTrace = debug.traceTransaction(tx);
   //console.log("txTrace: " + JSON.stringify(txTrace));
   //  var txTrace = [{ some: "value1"}, {"op": "VSLL", key2:"valueKey2"}, {"op": "CALL", key3:"valueKey3"}]

   // search for the "CALL" function that tells you if it is calling a smart contract's method
   //**** TODO - use _.where because it could have more than one CALL function if it is a Smart contract
   var txCall = _.findWhere( txTrace.structLogs, {"op": "CALL"});
   //console.log("txCall: " + JSON.stringify(txCall));

   if (txCall != undefined) {
	 //first of all we check if the transaction is out of GAS or has another type of error
	 // we could put this in the previous if call, but I want to be explicit and give the opportunity to check for other errors in the future
	 if( isOutOfGas(txTrace) ) return undefined;
	
	
     // extract the important parameters of the call   call(g, a, v, in, insize, out, outsize)
     // as defined in the opcodes specification http://solidity.readthedocs.io/en/latest/control-structures.html#opcodes
     // more importantly these parameters are contained in the stack variable
     // and you have to consider them form bottom to top, so the last 7 values inside of stack are the ones you are looking for
     // + the substrings get rid of the extra zeros at the beginning of the values
     // ++ the funchash is the first 4 bytes of the keccak-256 (sha3) hash of the function signature
     //      ie: createTokenProxy(address)   is converted to   baac5300f73541dd040cd7bd2ed39a84bf5d93f20ef523fefd16d2a13ac5013a  of which you keep only the first 4 bytes, or 8 characters
     //      one simple method to check the signature is https://emn178.github.io/online-tools/keccak_256.html
     //      if you know the hash of the signature but don't know the function name, check this to see if they have it in their db https://www.4byte.directory/signatures/?bytes4_signature=0xbaac5300 
 	 // ALSO IMPORTANT, read the following note on the imputData
     var s = txCall.stack;
     var funcHash = s[0].substring(56); // == "baac5300" (proxy) or "00000966" (direct) or anything else if the user has written something in the inputData, in which case 
     //console.log("funcHash:" + funcHash);
                                           
    
	//************** TRANSACTIONS WITH INPUT DATA
	// IMPORTANT: if the user has passed an inputData to the transaction, this (or something else) will be displayed in s[0], and the funcHash is in s[1], 
	// and all other values will therefore be pushed 1 index down the array
	// so we first verify if the calculated funcHash is NOT "proxy" or "direct", in which case we try to see if we can find these values in s[1]
	// if we can find them, we give a new stack without the first value, so that the following tracing params are contained in the right indexes
	// for example this transaction http://etherscan.io/tx/0xeea3be70ab2204693fb0bc30a37ab09aa47f790bd61f058efd7c2be4fa64a66b has input: "0x64616f20" 
	// which if you convert to Ascii like so  web3.toAscii("0x64616f20")    returns "dao"
	var inputDataHex, inputDataString; 
	var s1funcHash = s[1].substring(56);
	if ((funcHash != "baac5300" || funcHash != "00000966") && (s1funcHash == "baac5300" || s1funcHash == "00000966") ) {
		s.shift();
		funcHash = s[0].substring(56); 
		inputDataHex = web3.eth.getTransaction(tx).input;
		inputDataString = web3.toAscii(inputDataHex);
		//console.log("FOUND SPECIAL TX - funcHash: " + funcHash)
	}

     var address, weiToExtraBalance, creationType;
     var weiRaw

     if (funcHash == "baac5300") {
       //************* PROXIED TRANSACTION > VARIABLE POSITIONS IN THE stack (determined empirically) ******************
       // funcHash            = stack[0].substring(56);                     // baac5300
       // END_USER_ADDRESS    = "0x" + stack[2].substring(24);              // e300e1c3af964cf3ed089c7171c6145db05ea199
       // WEI_TO_EXTRABALANCE = web3.toBigNumber(stack[6]);                 // 91db92276747f5556
       // EXTRABAL_ADDRESS    = "0x" + stack[stack.length-2].substring(24); // 807640a13483f8ac783c557fcdf27be11ea4ac7a
          creationType = "proxy";
          address = "0x" + s[2].substring(24);
          weiToExtraBalance = web3.toBigNumber("0x" + s[6]);
          weiRaw = s[6]
          if(dbug) console.log("\n---- PROXY TRANSACTION for address: " + address + "    - wei amount: " + weiToExtraBalance + "   -  weiRaw: " + weiRaw);


     } else if (funcHash == "00000966") {
       //************* DIRECT TRANSACTION >> VARIABLE POSITIONS IN THE stack (determined empirically)******************
       // funcHash            = stack[0].substring(56);                     // 00000966
       // END_USER_ADDRESS    = "0x" + stack[3].substring(24);              // 0x2d5f0e392e90043ed2dbd57605b7534a169ae62e
       // WEI_TO_EXTRABALANCE = web3.toBigNumber(stack[stack.length-3]);    // 2e426101834d5556"
       // EXTRABAL_ADDRESS    = "0x" + stack[stack.length-2].substring(24); // 807640a13483f8ac783c557fcdf27be11ea4ac7a
          //console.log("---- DIRECT TRANSACTION")
          creationType = "direct";
          address = "0x" + s[3].substring(24);
          weiToExtraBalance = web3.toBigNumber("0x" + s[s.length-3]);
          weiRaw = s[s.length-3]
          if(dbug) console.log("\n---- DIRECT TRANSACTION for address: " + address + "    - wei amount: " + weiToExtraBalance + "   -  weiRaw: " + weiRaw);

     }
      
	var returnObj = {
       address: address,
       ebWei: weiToExtraBalance,
       txType: creationType
     }
	
	//add the input data if there is one  
	if (inputDataHex != undefined) {
		returnObj.inputDataHex = inputDataHex;
		returnObj.inputDataString = inputDataString;
	}
	
     return returnObj

   } else {
     return undefined;
   }
}
