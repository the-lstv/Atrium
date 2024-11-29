const States = {
    blockSearch: -1,
    blockName: 0,
    blockNameEnd: 1,
    attribute: 2,
    beforeProperties: 3,
    keywordSearch: 4,
    keyword: 5,
    valueStart: 6,
}


const Types = {
    default: 0,
    keyword: 1,
    string: 2,
    plain: 3,
    plaintext: 4,
    comment: 5,
}


const Match = {
    // From: /[\w-.]/
    keyword(code) {
        return(
            (code >= 48 && code <= 57) || // 0-9
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            code === 95 || // _
            code === 45 || // -
            code === 46    // .
        )
    },

    // From: /[\w-</>.*:]/
    plain_value(code) {
        return (
            (code >= 48 && code <= 57) || // 0-9
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            code === 95 || // _
            code === 45 || // -
            code === 46 || // .
            code === 42 || // *
            code === 58 || // :
            code === 60 || // <
            code === 62 || // >
            code === 47    // /
        )
    },

    // From: /["'`]/
    stringChar(code) {
        return code === 34 || code === 39 || code === 96;
    },

    // From: /[\s\n\r\t]/
    whitespace(code) {
        return code === 32 || code === 9 || code === 10 || code === 13;
    },

    // From: /^\d+(\.\d+)?$/
    digit(str) {
        let dotSeen = false;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code === 46) {
                if (dotSeen) return false;
                dotSeen = true;
            } else if (code < 48 || code > 57) {
                return false;
            }
        }
        return true;
    },

    // From: /\d/
    number(code) {
        return code >= 48 && code <= 57;
    },

    // From: 64
    initiator: "@",

    singleton: ["area", "base", "br", "col", "command", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"],
}


const Chars = {
    "\n": 10,
    "(": 40,
    ")": 41,
    "{": 123,
    "}": 125,
    ",": 44,
    ":": 58,
    ";": 59,
    "#": 35,
}


function parse(options){
    /*

        A fast parser for embedding dynamic behavior, config files, or any other use of the Akeno's block syntax.

    */


    // Backwards compatibility
    if(typeof options === "string"){
        if(typeof arguments[1] === "object"){
            options = arguments[1]
            arguments[1].content = arguments[0]
        } else {
            console.warn("[parser] Warning: Deprecated usage of parse(). Please consider upgrading to parse(options).");
            if(arguments[3]) console.warn("[parser] Deprecated use of importPath: Nothing will be imported! (Please move this logic to your own code!)");        
            
            options = {
                content: arguments[0],
                embedded: !arguments[1],
                strict: false, // Old parser did not have strict mode
                asLookupTable: true // This should be asArray to mimic old behavior, but most uses of parse were to be passed to configTools, which now uses lookupTable.
            }
        }
    }


    let blockPosition = -1;


    if(options.embedded){
        blockPosition = options.content.indexOf(Match.initiator);
    
        // Nothing to do, so just skip parsing entirely
        if(blockPosition === -1) return options.onText && options.onText(options.content);

        if(options.onText) options.onText(options.content.substring(0, blockPosition));
    } else {

        // Enable strict mode by default when not using embedded mode
        if(typeof options.strict === "undefined") options.strict = true;

    }


    let result = null;
    if(options.asArray) {
        result = []

        options._onBlock = function (block) {
            result.push(block)
        }
    } else if(options.asLookupTable) {
        result = new Map

        options._onBlock = function (block) {
            if (!result.has(block.name)) {
                result.set(block.name, []);
            }

            result.get(block.name).push(block);
        }
    }


    parseAt(options, blockPosition)
    return result;
}


function parseAt(options, initialBlockStart){
    let currentPosition = initialBlockStart;

    if(initialBlockStart >= options.content.length -1) return;

    let state = options.embedded? States.blockName: States.blockSearch,
        next_state = 0,
        parsedString = null,
        type = options.embedded? 1: 0,
        revert_type = null,
        confirmed = false,
        stringChar = null,
        current_value_isString = null,
        block = {
            name: null,
            attributes: [],
            properties: {}
        }
    ;

    let parsingValueStart = currentPosition, parsingValueLength = 1, parsingValueSequenceBroken = false;

    // Exit block
    function exit(cancel, message = null){
        const endPosition = currentPosition;

        if(cancel) {

            // TODO: Throw/broadcast error on cancelled exit when strict mode
            const error = new Error("[Parser Syntax Error] " + (message || "") + "\n  (at character " + currentPosition + ")");

            if(options.strict) currentPosition = options.content.length; // Skip to the end of the file
            if(typeof options.onError === "function") options.onError(error);

            // if(!options.embedded) currentPosition = initialBlockStart;

        } else {

            // No error, send block for processing
            if(options._onBlock) options._onBlock(block)
            if(options.onBlock) options.onBlock(block)
            currentPosition ++;

        }

        if(options.embedded) {

            // Find next block
            const blockPosition = options.content.indexOf(Match.initiator, currentPosition);

            if(options.onText) options.onText(options.content.slice(currentPosition, blockPosition !== -1? blockPosition: options.content.length));

            if(blockPosition !== -1) parseAt(options, blockPosition); else return;

        } else parseAt(options, endPosition)

    }

    function value_start(length = 0, positionOffset = 0, _type = null){
        if(_type !== null) type = _type;
        parsingValueStart = currentPosition + positionOffset;
        parsingValueLength = length;
        parsingValueSequenceBroken = false;
        parsedString = null;
    }

    function get_value(){
        return options.content.slice(parsingValueStart, parsingValueStart + parsingValueLength)
    }

    let last_key;

    while(currentPosition < options.content.length){
        currentPosition ++;

        const charCode = options.content.charCodeAt(currentPosition);

        if(type === Types.string) {
            // currentPosition += (options.content.indexOf(stringChar, currentPosition) - currentPosition) -1;

            if(charCode === stringChar && options.content.charCodeAt(currentPosition -1) !== 92){
                type = 0

                state = next_state

                parsedString = get_value()
            } else parsingValueLength ++
        } else

        if(type === Types.plaintext) {
            if(charCode === Chars["}"]){
                type = 0

                state = next_state

                parsedString = get_value()
            } else parsingValueLength ++
        } else

        if(type === Types.comment) {
            if(charCode === Chars["\n"]){
                type = revert_type
                currentPosition--
            }
        } else

        if(type === Types.plain) {
            if(!Match.plain_value(charCode)){
                type = 0
                state = next_state
                currentPosition--

                parsedString = get_value()
            } else parsingValueLength ++
        } else

        // Also skip whitespace when possible.
        if(type !== Types.default || !Match.whitespace(charCode)) {

            if(charCode === Chars["#"]) {
                while(options.content.charCodeAt(currentPosition) !== Chars["\n"] && currentPosition < options.content.length){
                    currentPosition ++
                }
                continue
            }

            switch(state){

                // Searching for the beginning of a block
                case States.blockSearch:
                    if(!Match.keyword(charCode)) return exit(true, "Unexpected character " + String.fromCharCode(charCode));
                    
                    state = States.blockName;
                    type = Types.keyword;
                    parsingValueStart = currentPosition
                    currentPosition --
                    parsingValueLength = 0
                    break

                // Beginning of a block name
                case States.blockName:
                    if(!Match.keyword(charCode)){

                        if(Match.whitespace(charCode)) {
                            parsingValueSequenceBroken = true
                            break
                        }

                        if(charCode !== Chars["("] && charCode !== Chars["{"]) return exit(true, "Unexpected character " + String.fromCharCode(charCode));

                        type = Types.default;
                        state = States.blockNameEnd;
                        currentPosition --

                    } else if (parsingValueSequenceBroken) return exit(true, "Space in keyword names is not allowed"); else parsingValueLength ++;
                    break;


                // End of a block name
                case States.blockNameEnd:
                    block.name = get_value().replace(Match.initiator, "")

                    if(charCode === Chars["("]){
                        state = States.attribute;
                    } else if (charCode === Chars["{"]) {
                        state = States.keywordSearch;
                    } else return exit(true);

                    break;


                // Attribute
                case States.attribute:
                    if(charCode === Chars[")"] || charCode === Chars[","]){
                        type = Types.default
                        if(parsedString) block.attributes.push(parsedString.trim())
                        if(charCode === Chars[")"]) state = States.beforeProperties;
                        break;
                    }

                    if(Match.stringChar(charCode)){
                        stringChar = charCode

                        value_start(0, 1, Types.string)

                        next_state = 2
                    } else if (Match.plain_value(charCode)){
                        type = Types.plain

                        value_start(1)

                        next_state = 2
                    } else return exit(true)

                    break


                // Before a block
                case States.beforeProperties:
                    if(charCode !== Chars[";"] && charCode !== Chars["{"]) return exit(true);

                    if(charCode === Chars[";"]){
                        return exit()
                    }

                    state = States.keywordSearch

                    break


                // Looking for a keyword
                case States.keywordSearch:
                    if(charCode === Chars["}"]){
                        return exit()
                    }

                    if(!Match.keyword(charCode)) return exit(true);

                    state = States.keyword

                    value_start(1, 0, Types.keyword)
                    break


                // Keyword
                case States.keyword:
                    if(!Match.keyword(charCode)){
                        if(Match.whitespace(charCode)) {
                            parsingValueSequenceBroken = true
                            break
                        }

                        const key = get_value().trim()

                        type = Types.default

                        if(charCode === Chars[";"] || charCode === Chars["}"]) {

                            block.properties[key] = [true]
                            state = States.keywordSearch

                            if(charCode === Chars["}"]){
                                return exit()
                            }

                        } else if (charCode === Chars[":"]) {

                            last_key = key
                            parsedString = null
                            state = States.valueStart

                        } else return exit(true);
                    } else {
                        if(parsingValueSequenceBroken) {
                            return exit(true)
                        }

                        parsingValueLength ++
                    }

                    break;


                // Start of a value
                case States.valueStart:

                    // Push values - this *was* supposed to write in an array only if there are multiple values, but this made working with data harder - property values are now always an array
                    if(parsedString){

                        if(!current_value_isString){
                            if(parsedString === "true") parsedString = true;
                            else if(parsedString === "false") parsedString = false;
                            else if(Match.digit(parsedString)) parsedString = Number(parsedString);
                        }

                        if(block.properties[last_key]) {
                            block.properties[last_key].push(parsedString)
                        } else {
                            block.properties[last_key] = [parsedString]
                        }

                        parsedString = null
                    }

                    current_value_isString = false;

                    if(charCode === Chars[","]){ // ,

                        type = Types.default
                        state = States.valueStart;
                        
                    } else if(charCode === Chars[";"]){ // ;

                        type = Types.default
                        state = States.keywordSearch;

                    } else if(charCode === Chars["}"]){ // }

                        return exit()

                    } else {
                        if(Match.stringChar(charCode)){
                            current_value_isString = true;
                            stringChar = charCode

                            value_start(0, 1, Types.string)

                            next_state = 6
                        } else if (Match.plain_value(charCode)){
                            current_value_isString = false;

                            value_start(1, 0, Types.plain)

                            next_state = 6
                        } else return exit(true)
                    };

                    break;
            }
        }
    }

    if(!confirmed) return exit(true);

    exit()
}



function stringify(config){
    if(!(parsed instanceof Map)) throw new Error("You must provide a parsed config as a lookup table.");

    let result = "";

    for(let array of config.values()){
        for(let block of array){
            if(!block) continue;
    
            result += `${
                // Block name
                block.name
            }${
                // Attributes
                block.attributes.length > 1 || block.attributes[0].length > 0? ` (${block.attributes.map(value => value.map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(" ")).join(", ") })` : ""
            }${
                // Properties
                Object.keys(block.properties).length > 0? ` {\n    ${Object.keys(block.properties).map(key => `${key}${block.properties[key] === true? "": `: ${block.properties[key].map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(", ")}`};`).join("\n    ")}\n}` : ";"
            }\n\n`
        }
    }
    
    return result;
}

function merge(base, newConfig){
    if(!(base instanceof Map) || !(newConfig instanceof Map)) throw new Error("Both arguments for merging must be a lookup table.");

    for(let key of base.keys()){
        if(newConfig.has(key)){
            newConfig.set(key, [...base.get(key), ...newConfig.get(key)])
        } else {
            newConfig.set(key, base.get(key))
        }
    }

    return newConfig // TODO: merge identical block's properties
}

function configTools(parsed){
    if(!(parsed instanceof Map)) throw new Error("You must provide a parsed config as a lookup table.");

    function block_proxy(block){
        if(block.__proxy) return block.__proxy;

        return block.__proxy = new Proxy(block, {
            get(target, prop) {
                if (prop === "get") {
                    return function (key, type, default_value = null){
                        if(block.isShadow) return default_value;

                        if(type === Array || type === null || type === undefined) return target.properties[key];
                        if(type === Boolean) return !!(target.properties[key] && target.properties[key][0]);
 
                        if(!target.properties.hasOwnProperty(key)) return default_value;
                        if(typeof type === "function") return type(target.properties[key] && target.properties[key][0]);

                        return default_value
                    }
                }

                return target[prop];
            }
        })
    }

    let tools = {
        data: parsed,

        has(name){
            return parsed.has(name)
        },

        block(name){
            let list = parsed.get(name);

            if(!list || list.length === 0){
                return block_proxy({
                    isShadow: true,
                    name,
                    attributes: [],
                    properties: {}
                })
            }

            return block_proxy(list[0])
        },

        *blocks(name){
            const blocks = parsed.get(name);

            if (blocks) {
                for (const block of blocks) {
                    yield block_proxy(block);
                }
            }
        },

        add(name, attributes, properties){
            if(!attributes) attributes = [[]];
            if(!properties) properties = {};

            for(let i = 0; i < attributes.length; i++) {
                if(!Array.isArray(attributes[i])) attributes[i] = [attributes[i]];
            }

            for(let key in properties) {
                if(!Array.isArray(properties[key]) || typeof properties[key] !== "boolean") properties[key] = [properties[key]];
            }

            if(!parsed.has(name)) parsed.set(name, []);

            parsed.get(name).push({
                name,
                attributes,
                properties
            })
        },

        forEach(name, callback){
            if(!parsed.has(name)) return;

            let list = parsed.get(name);

            let i = -1, _break = false;
            for(let block of parsed.get(name)){
                i++;

                if(_break) break;
                if(!block || typeof block !== "object") continue;

                if(block.name === name) callback(block_proxy(block), function(){
                    delete list[i]
                }, () => _break = true)
            }
        },

        // Deprecated
        valueOf(name){
            let block = tools.block(name);
            return block? block.attributes[0].join("") : null
        },

        stringify(){
            return stringify(parsed)
        },

        toString(){
            return tools.stringify()
        },

        merge(config){
            return parsed
            parsed = merge(parsed, config)
            return parsed
        }
    }
    
    return tools
}

let _exports = { Match, parser_regex: Match, parse, parseAt, stringify, merge, configTools };

if(!globalThis.window) module.exports = _exports; else window.AtriumParser = _exports;
