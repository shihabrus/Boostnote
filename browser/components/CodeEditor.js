import PropTypes from 'prop-types'
import React from 'react'
import _ from 'lodash'
import CodeMirror from 'codemirror'
import 'codemirror-mode-elixir'
import path from 'path'
import copyImage from 'browser/main/lib/dataApi/copyImage'
import { findStorage } from 'browser/lib/findStorage'
import fs from 'fs'
import eventEmitter from 'browser/main/lib/eventEmitter'
import iconv from 'iconv-lite'
const { ipcRenderer } = require('electron')

CodeMirror.modeURL = '../node_modules/codemirror/mode/%N/%N.js'

const defaultEditorFontFamily = ['Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', 'monospace']
const buildCMRulers = (rulers, enableRulers) =>
  enableRulers ? rulers.map(ruler => ({ column: ruler })) : []

function pass (name) {
  switch (name) {
    case 'ejs':
      return 'Embedded Javascript'
    case 'html_ruby':
      return 'Embedded Ruby'
    case 'objectivec':
      return 'Objective C'
    case 'text':
      return 'Plain Text'
    default:
      return name
  }
}

export default class CodeEditor extends React.Component {
  constructor (props) {
    super(props)

    this.scrollHandler = _.debounce(this.handleScroll.bind(this), 100, {leading: false, trailing: true})
    this.changeHandler = (e) => this.handleChange(e)
    this.focusHandler = () => {
      ipcRenderer.send('editor:focused', true)
    }
    this.blurHandler = (editor, e) => {
      ipcRenderer.send('editor:focused', false)
      if (e == null) return null
      let el = e.relatedTarget
      while (el != null) {
        if (el === this.refs.root) {
          return
        }
        el = el.parentNode
      }
      this.props.onBlur != null && this.props.onBlur(e)
    }
    this.pasteHandler = (editor, e) => this.handlePaste(editor, e)
    this.loadStyleHandler = (e) => {
      this.editor.refresh()
    }
    this.searchHandler = (e, msg) => this.handleSearch(msg)
    this.searchState = null
  }

  handleSearch (msg) {
    const cm = this.editor
    const component = this

    if (component.searchState) cm.removeOverlay(component.searchState)
    if (msg.length < 3) return

    cm.operation(function () {
      component.searchState = makeOverlay(msg, 'searching')
      cm.addOverlay(component.searchState)

      function makeOverlay (query, style) {
        query = new RegExp(query.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'), 'gi')
        return {
          token: function (stream) {
            query.lastIndex = stream.pos
            var match = query.exec(stream.string)
            if (match && match.index === stream.pos) {
              stream.pos += match[0].length || 1
              return style
            } else if (match) {
              stream.pos = match.index
            } else {
              stream.skipToEnd()
            }
          }
        }
      }
    })
  }

  componentDidMount () {
    const { rulers, enableRulers } = this.props
    const storagePath = findStorage(this.props.storageKey).path
    const expandDataFile = path.join(storagePath, 'expandData.json')
    const emptyChars = /\t|\s|\r|\n/
    if (!fs.existsSync(expandDataFile)) {
      const defaultExpandData = [
        {
          matches: ['lorem', 'ipsum'],
          content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
        },
        { match: 'h1', content: '# '},
        { match: 'h2', content: '## '},
        { match: 'h3', content: '### '},
        { match: 'h4', content: '#### '},
        { match: 'h5', content: '##### '},
        { match: 'h6', content: '###### '}
      ];
      fs.writeFileSync(expandDataFile, JSON.stringify(defaultExpandData), 'utf8')
    }
    const expandData = JSON.parse(fs.readFileSync(expandDataFile, 'utf8'))
    const expandSnippet = this.expandSnippet.bind(this)
    this.value = this.props.value
    this.editor = CodeMirror(this.refs.root, {
      rulers: buildCMRulers(rulers, enableRulers),
      value: this.props.value,
      lineNumbers: this.props.displayLineNumbers,
      lineWrapping: true,
      theme: this.props.theme,
      indentUnit: this.props.indentSize,
      tabSize: this.props.indentSize,
      indentWithTabs: this.props.indentType !== 'space',
      keyMap: this.props.keyMap,
      scrollPastEnd: this.props.scrollPastEnd,
      inputStyle: 'textarea',
      dragDrop: false,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      autoCloseBrackets: true,
      extraKeys: {
        Tab: function (cm) {
          const cursor = cm.getCursor()
          const line = cm.getLine(cursor.line)
          const cursorPosition = cursor.ch
          const charBeforeCursor = line.substr(cursorPosition - 1, 1)
          if (cm.somethingSelected()) cm.indentSelection('add')
          else {
            const tabs = cm.getOption('indentWithTabs')
            if (line.trimLeft().match(/^(-|\*|\+) (\[( |x)] )?$/)) {
              cm.execCommand('goLineStart')
              if (tabs) {
                cm.execCommand('insertTab')
              } else {
                cm.execCommand('insertSoftTab')
              }
              cm.execCommand('goLineEnd')
            } else if (!emptyChars.test(charBeforeCursor) || cursor.ch > 1) {
              // text expansion on tab key if the char before is alphabet
              if (expandSnippet(line, cursor, cm, expandData) === false) {
                if (tabs) {
                  cm.execCommand('insertTab')
                } else {
                  cm.execCommand('insertSoftTab')
                }
              }

            } else {
              if (tabs) {
                cm.execCommand('insertTab')
              } else {
                cm.execCommand('insertSoftTab')
              }
            }
          }
        },
        'Cmd-T': function (cm) {
          // Do nothing
        },
        Enter: 'boostNewLineAndIndentContinueMarkdownList',
        'Ctrl-C': (cm) => {
          if (cm.getOption('keyMap').substr(0, 3) === 'vim') {
            document.execCommand('copy')
          }
          return CodeMirror.Pass
        }
      }
    })

    this.setMode(this.props.mode)

    this.editor.on('focus', this.focusHandler)
    this.editor.on('blur', this.blurHandler)
    this.editor.on('change', this.changeHandler)
    this.editor.on('paste', this.pasteHandler)
    eventEmitter.on('top:search', this.searchHandler)

    eventEmitter.emit('code:init')
    this.editor.on('scroll', this.scrollHandler)

    const editorTheme = document.getElementById('editorTheme')
    editorTheme.addEventListener('load', this.loadStyleHandler)

    CodeMirror.Vim.defineEx('quit', 'q', this.quitEditor)
    CodeMirror.Vim.defineEx('q!', 'q!', this.quitEditor)
    CodeMirror.Vim.defineEx('wq', 'wq', this.quitEditor)
    CodeMirror.Vim.defineEx('qw', 'qw', this.quitEditor)
    CodeMirror.Vim.map('ZZ', ':q', 'normal')
  }

  expandSnippet(line, cursor, cm, expandData) {
    let wordBeforeCursor = this.getWordBeforeCursor(line, cursor.line, cursor.ch)
    for (let i = 0; i < expandData.length; i++) {
      if (Array.isArray(expandData[i].matches)) {
        if (expandData[i].matches.indexOf(wordBeforeCursor.text) !== -1) {
          cm.replaceRange(
            expandData[i].content, 
            wordBeforeCursor.range.from,
            wordBeforeCursor.range.to
          )
          return true
        }
      }
      else if (typeof(expandData[i].matches) === 'string') {
        if (expandData[i].match === wordBeforeCursor.text) {
          cm.replaceRange(
            expandData[i].content, 
            wordBeforeCursor.range.from,
            wordBeforeCursor.range.to
          )
          return true
        }
      }
    }

    return false
  }

  getWordBeforeCursor(line, lineNumber, cursorPosition) {
    let wordBeforeCursor = ''
    let originCursorPosition = cursorPosition
    const emptyChars = /\t|\s|\r|\n/

    // to prevent the word to expand is long that will crash the whole app
    // the safeStop is there to stop user to expand words that longer than 20 chars
    const safeStop = 20

    while (cursorPosition > 0) {
      let currentChar = line.substr(cursorPosition - 1, 1)
      // if char is not an empty char
      if (!emptyChars.test(currentChar)) {
        wordBeforeCursor = currentChar + wordBeforeCursor
      } else if (wordBeforeCursor.length >= safeStop) {
        throw new Error("Your text expansion word is too long !")
      } else {
        break
      }
      cursorPosition--;
    }

    return {
      text: wordBeforeCursor,
      range: {
        from: {line: lineNumber, ch: originCursorPosition},
        to: {line: lineNumber, ch: cursorPosition}
      }
    }
  }

  quitEditor () {
    document.querySelector('textarea').blur()
  }

  componentWillUnmount () {
    this.editor.off('focus', this.focusHandler)
    this.editor.off('blur', this.blurHandler)
    this.editor.off('change', this.changeHandler)
    this.editor.off('paste', this.pasteHandler)
    eventEmitter.off('top:search', this.searchHandler)
    this.editor.off('scroll', this.scrollHandler)
    const editorTheme = document.getElementById('editorTheme')
    editorTheme.removeEventListener('load', this.loadStyleHandler)
  }

  componentDidUpdate (prevProps, prevState) {
    let needRefresh = false
    const { rulers, enableRulers } = this.props
    if (prevProps.mode !== this.props.mode) {
      this.setMode(this.props.mode)
    }
    if (prevProps.theme !== this.props.theme) {
      this.editor.setOption('theme', this.props.theme)
      // editor should be refreshed after css loaded
    }
    if (prevProps.fontSize !== this.props.fontSize) {
      needRefresh = true
    }
    if (prevProps.fontFamily !== this.props.fontFamily) {
      needRefresh = true
    }
    if (prevProps.keyMap !== this.props.keyMap) {
      needRefresh = true
    }

    if (prevProps.enableRulers !== enableRulers || prevProps.rulers !== rulers) {
      this.editor.setOption('rulers', buildCMRulers(rulers, enableRulers))
    }

    if (prevProps.indentSize !== this.props.indentSize) {
      this.editor.setOption('indentUnit', this.props.indentSize)
      this.editor.setOption('tabSize', this.props.indentSize)
    }
    if (prevProps.indentType !== this.props.indentType) {
      this.editor.setOption('indentWithTabs', this.props.indentType !== 'space')
    }

    if (prevProps.displayLineNumbers !== this.props.displayLineNumbers) {
      this.editor.setOption('lineNumbers', this.props.displayLineNumbers)
    }

    if (prevProps.scrollPastEnd !== this.props.scrollPastEnd) {
      this.editor.setOption('scrollPastEnd', this.props.scrollPastEnd)
    }

    if (needRefresh) {
      this.editor.refresh()
    }
  }

  setMode (mode) {
    let syntax = CodeMirror.findModeByName(pass(mode))
    if (syntax == null) syntax = CodeMirror.findModeByName('Plain Text')

    this.editor.setOption('mode', syntax.mime)
    CodeMirror.autoLoadMode(this.editor, syntax.mode)
  }

  handleChange (e) {
    this.value = this.editor.getValue()
    if (this.props.onChange) {
      this.props.onChange(e)
    }
  }

  moveCursorTo (row, col) {
  }

  scrollToLine (num) {
  }

  focus () {
    this.editor.focus()
  }

  blur () {
    this.editor.blur()
  }

  reload () {
    // Change event shouldn't be fired when switch note
    this.editor.off('change', this.changeHandler)
    this.value = this.props.value
    this.editor.setValue(this.props.value)
    this.editor.clearHistory()
    this.editor.on('change', this.changeHandler)
    this.editor.refresh()
  }

  setValue (value) {
    const cursor = this.editor.getCursor()
    this.editor.setValue(value)
    this.editor.setCursor(cursor)
  }

  handleDropImage (e) {
    e.preventDefault()
    const ValidImageTypes = ['image/gif', 'image/jpeg', 'image/png']

    const file = e.dataTransfer.files[0]
    const filePath = file.path
    const filename = path.basename(filePath)
    const fileType = file['type']

    copyImage(filePath, this.props.storageKey).then((imagePath) => {
      var showPreview = ValidImageTypes.indexOf(fileType) > 0
      const imageMd = `${showPreview ? '!' : ''}[${filename}](${path.join('/:storage', imagePath)})`
      this.insertImageMd(imageMd)
    })
  }

  insertImageMd (imageMd) {
    this.editor.replaceSelection(imageMd)
  }

  handlePaste (editor, e) {
    const clipboardData = e.clipboardData
    const dataTransferItem = clipboardData.items[0]
    const pastedTxt = clipboardData.getData('text')
    const isURL = (str) => {
      const matcher = /^(?:\w+:)?\/\/([^\s\.]+\.\S{2}|localhost[\:?\d]*)\S*$/
      return matcher.test(str)
    }
    const isInLinkTag = (editor) => {
      const startCursor = editor.getCursor('start')
      const prevChar = editor.getRange(
        { line: startCursor.line, ch: startCursor.ch - 2 },
        { line: startCursor.line, ch: startCursor.ch }
      )
      const endCursor = editor.getCursor('end')
      const nextChar = editor.getRange(
        { line: endCursor.line, ch: endCursor.ch },
        { line: endCursor.line, ch: endCursor.ch + 1 }
      )
      return prevChar === '](' && nextChar === ')'
    }
    if (dataTransferItem.type.match('image')) {
      const blob = dataTransferItem.getAsFile()
      const reader = new FileReader()
      let base64data

      reader.readAsDataURL(blob)
      reader.onloadend = () => {
        base64data = reader.result.replace(/^data:image\/png;base64,/, '')
        base64data += base64data.replace('+', ' ')
        const binaryData = new Buffer(base64data, 'base64').toString('binary')
        const imageName = Math.random().toString(36).slice(-16)
        const storagePath = findStorage(this.props.storageKey).path
        const imageDir = path.join(storagePath, 'images')
        if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir)
        const imagePath = path.join(imageDir, `${imageName}.png`)
        fs.writeFile(imagePath, binaryData, 'binary')
        const imageMd = `![${imageName}](${path.join('/:storage', `${imageName}.png`)})`
        this.insertImageMd(imageMd)
      }
    } else if (this.props.fetchUrlTitle && isURL(pastedTxt) && !isInLinkTag(editor)) {
      this.handlePasteUrl(e, editor, pastedTxt)
    }
  }

  handleScroll (e) {
    if (this.props.onScroll) {
      this.props.onScroll(e)
    }
  }

  handlePasteUrl (e, editor, pastedTxt) {
    e.preventDefault()
    const taggedUrl = `<${pastedTxt}>`
    editor.replaceSelection(taggedUrl)

    fetch(pastedTxt, {
      method: 'get'
    }).then((response) => {
      return this.decodeResponse(response)
    }).then((response) => {
      const parsedResponse = (new window.DOMParser()).parseFromString(response, 'text/html')
      const value = editor.getValue()
      const cursor = editor.getCursor()
      const LinkWithTitle = `[${parsedResponse.title}](${pastedTxt})`
      const newValue = value.replace(taggedUrl, LinkWithTitle)
      editor.setValue(newValue)
      editor.setCursor(cursor)
    }).catch((e) => {
      const value = editor.getValue()
      const newValue = value.replace(taggedUrl, pastedTxt)
      const cursor = editor.getCursor()
      editor.setValue(newValue)
      editor.setCursor(cursor)
    })
  }

  decodeResponse (response) {
    const headers = response.headers
    const _charset = headers.has('content-type')
      ? this.extractContentTypeCharset(headers.get('content-type'))
      : undefined
    return response.arrayBuffer().then((buff) => {
      return new Promise((resolve, reject) => {
        try {
          const charset = _charset !== undefined && iconv.encodingExists(_charset) ? _charset : 'utf-8'
          resolve(iconv.decode(new Buffer(buff), charset).toString())
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  extractContentTypeCharset (contentType) {
    return contentType.split(';').filter((str) => {
      return str.trim().toLowerCase().startsWith('charset')
    }).map((str) => {
      return str.replace(/['"]/g, '').split('=')[1]
    })[0]
  }

  render () {
    const { className, fontSize } = this.props
    let fontFamily = this.props.fontFamily
    fontFamily = _.isString(fontFamily) && fontFamily.length > 0
      ? [fontFamily].concat(defaultEditorFontFamily)
      : defaultEditorFontFamily
    return (
      <div
        className={className == null
          ? 'CodeEditor'
          : `CodeEditor ${className}`
        }
        ref='root'
        tabIndex='-1'
        style={{
          fontFamily: fontFamily.join(', '),
          fontSize: fontSize
        }}
        onDrop={(e) => this.handleDropImage(e)}
      />
    )
  }
}

CodeEditor.propTypes = {
  value: PropTypes.string,
  enableRulers: PropTypes.bool,
  rulers: PropTypes.arrayOf(Number),
  mode: PropTypes.string,
  className: PropTypes.string,
  onBlur: PropTypes.func,
  onChange: PropTypes.func,
  readOnly: PropTypes.bool
}

CodeEditor.defaultProps = {
  readOnly: false,
  theme: 'xcode',
  keyMap: 'sublime',
  fontSize: 14,
  fontFamily: 'Monaco, Consolas',
  indentSize: 4,
  indentType: 'space'
}
