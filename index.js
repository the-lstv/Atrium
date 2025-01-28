const version = "1.1.0";

const States = {
    blockSearch: -1,
    blockName: 0,
    blockNameEnd: 1,
    attribute: 2,
    beforeProperties: 3,
    keywordSearch: 4,
    keyword: 5,
    arbitraryValue: 6,
    writeKeywordValue: 7
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
    initiator: "@"
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
    "\\": 92
}


class ParserState {
    constructor(options, state = {}){
        this.options = options
        this.offset = typeof state.offset === "number"? state.offset: -1
        this.index = this.offset
        this.recursed = 0
        this.closedAtLevel = -1

        this.recursionLevels = new Map;

        this.blockState = new BlockState(this)

        this.recursionLevels.set(this.recursed, this.blockState)
    }

    fastForwardTo(char){
        const index = this.buffer.indexOf(char, this.index +1)

        if(index === -1) {
            this.index = this.buffer.length;
            return false
        }

        this.index = index -1
        return true
    }

    write(chunk){
        if(this.buffer) throw ".write called more than once: Sorry, streaming is currently not supported. Please check for latest updates.";
        this.buffer = chunk
        this.index = this.offset
        // this.blockState.parsingValueStart = this.index +1;
        // this.blockState.parsingValueLength = 0;
        this.offset = -1
        parseAt(this, this.blockState)
        return this
    }

    end(){
        // TODO:
    }
}


class BlockState {
    constructor(parent){
        this.parent = parent
        this.clear()
    }

    clear(returnBlock = false){
        this.parsing_state = this.parent.options.embedded? States.blockName: States.blockSearch;
        this.next_parsing_state = 0;
        this.parsedValue = null;
        this.type = this.parent.options.embedded? 1: 0;
        this.parsingValueStart = this.parent.index;
        this.parsingValueLength = 0;
        this.parsingValueSequenceBroken = false;
        this.last_key = null;

        this.quit = false;

        if(returnBlock){

            const block = this.block

            this.block = {
                name: null,
                attributes: [],
                properties: {}
            }

            return block;

        } else if(this.block) {

            this.block.name = null
            this.block.attributes.length = 0
            this.block.properties = {}

        } else {
            this.block = {
                name: null,
                attributes: [],
                properties: {}
            }
        }
    }

    close(cancel, message){
        const recursive = this.parent.recursed !== 0;
        if(recursive) {
            this.parent.recursed --;
        }

        if(!cancel) {

            const block = this.clear(true)

            // No error, send block for processing
            if(!recursive) {
                if(this.parent.options._onBlock) this.parent.options._onBlock(block);
                if(this.parent.options.onBlock) this.parent.options.onBlock(block);
            } else {
                this._returnedBlock = block
            }

        } else {

            this.clear()

            const error = new Error("[Parser Syntax Error] " + (message || "") + "\n  (at character " + this.parent.index + ")");

            if(this.parent.options.strict) this.parent.index = this.parent.buffer.length; // Skip to the end of the file
            if(typeof this.parent.options.onError === "function") this.parent.options.onError(error);

        }

        if(recursive) {
            this.quit = true
        }

        this.parent.index++;

        if(this.parent.options.embedded) {

            const start = this.parent.index;
            const found = this.parent.fastForwardTo(Match.initiator)

            if(found){
                this.parent.index++;
                this.parent.parsingValueStart = this.parent.index +1
            }

            if(this.parent.options.onText) this.parent.options.onText(this.parent.buffer.slice(start, this.parent.index));

        }
    }

    value_start(length = 0, positionOffset = 0, _type = null){
        if(_type !== null) this.type = _type;
        this.parsingValueStart = this.parent.index + positionOffset;
        this.parsingValueLength = length;
        this.parsingValueSequenceBroken = false;
        this.parsedValue = null;
    }

    get_value(){
        return this.parent.buffer.slice(this.parsingValueStart, this.parsingValueStart + this.parsingValueLength)
    }

    begin_arbitrary_value(returnTo){
        this.parsedValue = null
        this.parsing_state = States.arbitraryValue
        this.type = Types.default
        this.next_parsing_state = returnTo
    }
}


function parseAt(state, blockState){
    if(state.index >= state.buffer.length -1) return;

    while(++state.index < state.buffer.length){

        if(blockState.quit) {
            blockState.quit = false
            return blockState
        }

        if(blockState.type === Types.plain){
            if (!Match.plain_value(state.buffer.charCodeAt(state.index))) {
                blockState.parsedValue = blockState.get_value()

                if(blockState.parsedValue === "true") blockState.parsedValue = true;
                else if(blockState.parsedValue === "false") blockState.parsedValue = false;
                else if(Match.digit(blockState.parsedValue)) blockState.parsedValue = Number(blockState.parsedValue);

                blockState.type = Types.default
                blockState.parsing_state = blockState.next_parsing_state
            } else {
                blockState.parsingValueLength++
                continue
            }
        }


        const charCode = state.buffer.charCodeAt(state.index);


        // Skip whitespace if possible.
        if(blockState.type === Types.default && Match.whitespace(charCode)){
            continue
        }

        // Skip comments
        if(charCode === Chars["#"]) {
            state.fastForwardTo("\n")
            continue
        }

        switch(blockState.parsing_state){

            // Searching for the beginning of a block
            case States.blockSearch:
                if(!Match.keyword(charCode)) {
                    blockState.close(true, "Unexpected character " + String.fromCharCode(charCode));
                    continue
                }

                blockState.parsing_state = States.blockName;
                blockState.type = Types.keyword;
                blockState.parsingValueStart = state.index
                blockState.parsingValueLength = 1
                break


            // Beginning of a block name
            case States.blockName:
                if(!Match.keyword(charCode)){

                    if(Match.whitespace(charCode)) {
                        blockState.parsingValueSequenceBroken = true
                        break
                    }

                    if(charCode !== Chars["("] && charCode !== Chars["{"]) { blockState.close(true, "Unexpected character " + String.fromCharCode(charCode)); continue};

                    blockState.type = Types.default;
                    blockState.parsing_state = States.blockNameEnd;
                    state.index --

                } else if (blockState.parsingValueSequenceBroken) {blockState.close(true, "Space in keyword names is not allowed"); continue} else blockState.parsingValueLength ++;
                break;


            // End of a block name
            case States.blockNameEnd:
                const name = blockState.get_value();

                if(name) blockState.block.name = name; else delete blockState.block.name;

                if(charCode === Chars["("]){
                    const nextChar = state.buffer.charCodeAt(state.index +1);

                    if(nextChar === Chars[")"]){
                        blockState.type = Types.default;
                        blockState.parsing_state = States.beforeProperties;
                        state.index ++;
                    } else blockState.begin_arbitrary_value(States.attribute);

                } else if (charCode === Chars["{"]) {
                    blockState.parsing_state = States.keywordSearch;
                } else blockState.close(true);

                break;


            // Before a block
            case States.beforeProperties:
                if(charCode === Chars[";"]){
                    blockState.close()
                    continue
                }

                if(charCode === Chars["{"]){
                    blockState.parsing_state = States.keywordSearch
                    continue
                }

                blockState.close(true);
                continue


            // Looking for a keyword
            case States.keywordSearch:
                if(charCode === Chars["}"]){
                    blockState.close()
                    continue
                }

                if(!Match.keyword(charCode)) { blockState.close(true); continue };

                blockState.parsing_state = States.keyword

                blockState.value_start(1, 0, Types.keyword)
                break


            // Keyword
            case States.keyword:
                if(!Match.keyword(charCode)){
                    if(Match.whitespace(charCode)) {
                        blockState.parsingValueSequenceBroken = true
                        break
                    }

                    const key = blockState.get_value()

                    blockState.type = Types.default

                    if(charCode === Chars[";"] || charCode === Chars["}"]) {

                        blockState.block.properties[key] = [true]
                        blockState.parsing_state = States.keywordSearch

                        if(charCode === Chars["}"]){
                            blockState.close()
                            continue
                        }

                    } else if (charCode === Chars[":"]) {

                        blockState.last_key = key
                        blockState.begin_arbitrary_value(States.writeKeywordValue)

                    } else if (charCode === Chars["{"] || charCode === Chars["("]) {

                        state.recursed ++;

                        let level = state.recursionLevels.get(state.recursed);
                        if(!level) {
                            level = new BlockState(state);
                            state.recursionLevels.set(state.recursed, level)
                        }

                        level.parsing_state = charCode === Chars["{"]? States.keywordSearch: States.attribute;

                        parseAt(state, level);

                        state.index --;

                        blockState.block.properties[key] = level._returnedBlock;

                        level._returnedBlock = null;

                        blockState.parsing_state = States.keywordSearch

                    } else { blockState.close(true); continue };
                } else {
                    if(blockState.parsingValueSequenceBroken) {
                        blockState.close(true)
                        continue
                    }

                    blockState.parsingValueLength ++
                }

                break;


            case States.writeKeywordValue:
                if(blockState.parsedValue !== null){
                    if(blockState.block.properties[blockState.last_key]) {
                        blockState.block.properties[blockState.last_key].push(blockState.parsedValue)
                    } else {
                        blockState.block.properties[blockState.last_key] = [blockState.parsedValue]
                    }

                    blockState.parsedValue = null
                }

                if(charCode === Chars[","]){

                    blockState.type = Types.default
                    blockState.parsing_state = States.arbitraryValue;
                    
                } else if(charCode === Chars[";"]){

                    blockState.type = Types.default
                    blockState.parsing_state = States.keywordSearch;

                } else if(charCode === Chars["}"]){

                    blockState.close()
                    continue

                }
                break;

            case States.attribute:
                if(blockState.parsedValue !== null) {
                    blockState.block.attributes.push(blockState.parsedValue);
                    blockState.parsedValue = null;
                }

                blockState.type = Types.default;

                if(charCode === Chars[")"]) blockState.parsing_state = States.beforeProperties;
                if(charCode === Chars[","]) blockState.begin_arbitrary_value(States.attribute);
                break;


            // Beginning of a value
            case States.arbitraryValue:
                // TODO: Both attributes and values should be handled by the same state (all values)

                if(Match.stringChar(charCode)){

                    // Match strings
                    // TODO: Remove escape characters from the string

                    const stringChar = String.fromCharCode(charCode);

                    blockState.value_start(0, 1)

                    state.fastForwardTo(stringChar);

                    while(state.buffer.charCodeAt(state.index) === Chars["\\"] && state.index < state.buffer.length -1) {
                        state.index++;
                        state.fastForwardTo(stringChar);
                    }

                    blockState.parsingValueLength = state.index - blockState.parsingValueStart +1;

                    blockState.parsedValue = blockState.get_value();

                    blockState.parsing_state = blockState.next_parsing_state;

                } else if (Match.plain_value(charCode)){

                    // Match plain values
                    blockState.value_start(1, 0, Types.plain)

                } else blockState.close(true)
                break;
        }
    }
}

// Following are helper functions.

function parse(data, options = { asArray: true }){
    /*

        A really fast parser for embedding dynamic behavior, config files, or any other use of the Atrium syntax.

    */


    // TODO: This should be moved to the parser itself!
    let offset = -1;
    if(options.embedded){
        offset = data.indexOf(Match.initiator);
    
        // Nothing to do, so just skip parsing entirely and return everything as text
        if(offset === -1) return options.onText && options.onText(data);

        if(options.onText) options.onText(data.substring(0, offset));
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

    new ParserState(options, { offset }).write(data)
    return result;
}


function stringify(parsed){
    if(!(parsed instanceof Map)) throw new Error("You must provide a parsed config as a lookup table.");

    let result = "";

    for(let array of parsed.values()){
        for(let block of array){
            if(!block) continue;
    
            result += `${
                // Block name
                block.name
            }${
                // Attributes
                block.attributes.length > 1 || block.attributes[0].length > 0? ` (${block.attributes.map(value => {let quote = value.includes('"')? "'": '"'; return `${quote}${value}${quote}`}).join(", ") })` : ""
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


let _exports = { parse, parserStream: ParserState, BlockState, Match, parseAt, stringify, merge, configTools, version, v: parseInt(version[0]) };

if(!globalThis.window) module.exports = _exports; else window.AtriumParser = _exports;