![Group 357](https://github.com/user-attachments/assets/f6377875-ba97-4a1b-80aa-2ce5ff0374ae)

Atrium is the parser that powers [Akeno](https://github.com/the-lstv/Akeno).<br>
It is an extremely fast, memory-efficient and highly configurable and versatile parser written in JavaScript.

It efficiently manages block states and only clones objects when necesarry.

---

### Usage
This is the most basic way to use the parser:
```js
const { parse } = require("./atrium")

parse("hello { world }", {
  onBlock(block) {
    console.log(block) // { name: "hello", attributes: [], properties: { world: [ true ] } }
  }
})
```
Options include:
- `content`: the content to parse
- `embedded`: run in embedded mode
- `strict`: if true, errors will terminate parsing
- `onBlock`: called when a block is parsed
- `onText`: called on text in embed mode
- `onError`: called on syntax errors
- `asArray`: if the parse function should return an array of blocks
- `asLookupTable`: if the parse function should a lookup map for efficient data access

### Syntax
![Syntax](https://cdn.extragon.cloud/file/ef25afa3bf73cc5aa2f3f4ca2327ba15.png)


### Streaming
Streaming content is possible:
Streaming allows for some extra performance and chunked parsing, for when you receive content in chunks, to avoid having to concat all chunks and parse them at once.
```js
const { parserStream } = require("./atrium")

// NOTE: parserStream currently doesnt work with options like "asArray".
const stream = new parserStream({
  onBlock(block) {
    console.log(block)
  }
})

stream.write("blo")
stream.write("ck {")
stream.write("} ") // At this point, onBlock would be called

stream.end()
```
### Embedded mode
Atrium is designed to work among other formats, like HTML, using embedded mode.<br>
Embedded mode requires all blocks to begin with "@".
```js
const { parse } = require("./atrium")

parse("<div> @hello { world } </div>", {
  embedded: true,
  onBlock(block) {
    console.log(block)
  },
  onText(text) {
    console.log(text) // "<div> ", " </div>"
  }
})
```
