'use strict'

let tid = 0
const frameMap = new Map()
const elementsList = document.getElementById('elements-list')
const allElements = document.getElementById('all-elements')
const indivElements = document.getElementById('individual-elements')
const elementsTpl = document.getElementById('elements-tpl')

// Функция для проверки доступности Chrome API
function isChromeApiAvailable() {
    return typeof chrome !== 'undefined' && chrome.scripting && chrome.tabs;
}

// Универсальная функция для работы с API (Chrome/Browser)
const extensionAPI = {
    tabs: (isChromeApiAvailable() ? chrome.tabs : (typeof browser !== 'undefined' ? browser.tabs : null)),
    scripting: (isChromeApiAvailable() ? chrome.scripting : null)
};

function applySettings (fid, elid, newSettings) {
    if (!extensionAPI.scripting) {
        console.error('Scripting API not available');
        return Promise.reject('API not available');
    }

    return extensionAPI.scripting.executeScript({
        target: { tabId: tid, allFrames: false },
        func: (elid, newSettings) => {
            try {
                const el = document.querySelector(`[data-x-soundfixer-id="${elid}"]`)
                if (!el) {
                    console.error('Element not found:', elid);
                    return { error: 'Element not found' };
                }

                // Проверяем, можем ли мы создать AudioContext
                if (!window.AudioContext && !window.webkitAudioContext) {
                    return { error: 'AudioContext not supported' };
                }

                if (!el.xSoundFixerContext) {
                    try {
                        el.xSoundFixerContext = new (window.AudioContext || window.webkitAudioContext)();
                        
                        // Возобновляем контекст если он приостановлен
                        if (el.xSoundFixerContext.state === 'suspended') {
                            el.xSoundFixerContext.resume();
                        }

                        el.xSoundFixerGain = el.xSoundFixerContext.createGain()
                        el.xSoundFixerPan = el.xSoundFixerContext.createStereoPanner()
                        el.xSoundFixerSplit = el.xSoundFixerContext.createChannelSplitter(2)
                        el.xSoundFixerMerge = el.xSoundFixerContext.createChannelMerger(2)
                        el.xSoundFixerSource = el.xSoundFixerContext.createMediaElementSource(el)
                        el.xSoundFixerSource.connect(el.xSoundFixerGain)
                        el.xSoundFixerGain.connect(el.xSoundFixerPan)
                        el.xSoundFixerPan.connect(el.xSoundFixerContext.destination)
                        el.xSoundFixerOriginalChannels = el.xSoundFixerContext.destination.channelCount
                    } catch (err) {
                        console.error('Failed to create audio context:', err);
                        return { error: 'Failed to create audio context: ' + err.message };
                    }
                }

                if ('gain' in newSettings) {
                    el.xSoundFixerGain.gain.value = newSettings.gain
                }
                if ('pan' in newSettings) {
                    el.xSoundFixerPan.pan.value = newSettings.pan
                }
                if ('mono' in newSettings) {
                    el.xSoundFixerContext.destination.channelCount = newSettings.mono ? 1 : el.xSoundFixerOriginalChannels
                }
                if ('flip' in newSettings) {
                    el.xSoundFixerFlipped = newSettings.flip
                    el.xSoundFixerMerge.disconnect()
                    el.xSoundFixerPan.disconnect()
                    if (el.xSoundFixerFlipped) {
                        el.xSoundFixerPan.connect(el.xSoundFixerSplit)
                        el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 0, 1)
                        el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 1, 0)
                        el.xSoundFixerMerge.connect(el.xSoundFixerContext.destination)
                    } else {
                        el.xSoundFixerPan.connect(el.xSoundFixerContext.destination)
                    }
                }
                
                el.xSoundFixerSettings = {
                    gain: el.xSoundFixerGain.gain.value,
                    pan: el.xSoundFixerPan.pan.value,
                    mono: el.xSoundFixerContext.destination.channelCount == 1,
                    flip: el.xSoundFixerFlipped,
                }
                
                return { success: true, settings: el.xSoundFixerSettings };
            } catch (error) {
                console.error('Error in applySettings:', error);
                return { error: error.message };
            }
        },
        args: [elid, newSettings]
    }).catch(err => {
        console.error('Failed to execute script:', err);
        return [{ result: { error: err.message } }];
    })
}

// Проверяем доступность API
if (!extensionAPI.tabs) {
    allElements.innerHTML = 'Extension API not available. Please reload the page and try again.';
    throw new Error('Extension API not available');
}

extensionAPI.tabs.query({ currentWindow: true, active: true }).then(tabs => {
    if (!tabs || tabs.length === 0) {
        throw new Error('No active tab found');
    }
    
    tid = tabs[0].id
    
    if (!extensionAPI.scripting) {
        throw new Error('Scripting API not available');
    }
    
    return extensionAPI.scripting.executeScript({
        target: { tabId: tid, allFrames: false },
        func: () => {
            try {
                const result = {}
                const mediaElements = document.querySelectorAll('video, audio')
                
                if (mediaElements.length === 0) {
                    return { error: 'No media elements found' };
                }
                
                for (const el of mediaElements) {
                    if (!el.hasAttribute('data-x-soundfixer-id')) {
                        el.setAttribute('data-x-soundfixer-id',
                            Math.random().toString(36).substr(2, 10))
                    }
                    result[el.getAttribute('data-x-soundfixer-id')] = {
                        type: el.tagName.toLowerCase(),
                        isPlaying: (el.currentTime > 0 && !el.paused && !el.ended && el.readyState > 2),
                        settings: el.xSoundFixerSettings,
                        src: el.src || el.currentSrc || 'unknown'
                    };
                }
                return { result: result, count: mediaElements.length };
            } catch (error) {
                console.error('Error finding media elements:', error);
                return { error: error.message };
            }
        }
    })
}).then(results => {
    if (!results || !results[0]) {
        throw new Error('No results from script execution');
    }
    
    const scriptResult = results[0].result;
    
    if (scriptResult.error) {
        console.error('Script error:', scriptResult.error);
        allElements.innerHTML = `Error: ${scriptResult.error}`;
        return;
    }
    
    if (scriptResult.result && typeof scriptResult.result === 'object') {
        // Chrome API всегда возвращает обычные объекты, преобразуем в Map
        const resultMap = new Map();
        for (const [key, value] of Object.entries(scriptResult.result)) {
            resultMap.set(key, value);
        }
        frameMap.set(0, resultMap);
        console.log(`Found ${scriptResult.count || 0} media elements`);
    } else {
        frameMap.set(0, new Map());
        console.log('No media elements found');
    }
    
    return Promise.resolve();
}).then(_ => {
    elementsList.textContent = ''
    let elCount = 0
    
    for (const [fid, els] of frameMap) {
        for (const [elid, el] of els) {
            const settings = el.settings || {}
            const node = document.createElement('li')
            node.appendChild(document.importNode(elementsTpl.content, true))
            node.dataset.fid = fid
            node.dataset.elid = elid
            node.querySelector('.element-label').textContent = `
                ${el.type.charAt(0).toUpperCase() + el.type.slice(1)}
                ${elCount + 1}
                ${fid ? `in frame ${fid}` : ''}
                ${el.isPlaying ? '' : '(not playing)'}
            `.trim()
            
            if (!el.isPlaying)
                node.querySelector('.element-label').classList.add('element-not-playing')
                
            const gain = node.querySelector('.element-gain')
            const gainNumberInput = node.querySelector('.element-gain-num')
            gain.value = settings.gain || 1
            gainNumberInput.value = '' + gain.value
            
            gain.addEventListener('input', function () {
                applySettings(fid, elid, { gain: this.value }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
                this.parentElement.querySelector('.element-gain-num').value = '' + this.value
            })
            
            gainNumberInput.addEventListener('input', function () {
                if (+this.value > +this.getAttribute('max'))
                    this.value = this.getAttribute('max')
                if (+this.value < +this.getAttribute('min'))
                    this.value = this.getAttribute('min')
                
                applySettings(fid, elid, { gain: this.value }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
                this.parentElement.querySelector('.element-gain').value = '' + this.value
            })
            
            const pan = node.querySelector('.element-pan')
            const panNumberInput = node.querySelector('.element-pan-num')
            pan.value = settings.pan || 0
            panNumberInput.value = '' + pan.value
            
            pan.addEventListener('input', function () {
                applySettings(fid, elid, { pan: this.value }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
                this.parentElement.querySelector('.element-pan-num').value = '' + this.value
            })
            
            panNumberInput.addEventListener('input', function () {
                if (+this.value > +this.getAttribute('max'))
                    this.value = this.getAttribute('max')
                if (+this.value < +this.getAttribute('min'))
                    this.value = this.getAttribute('min')
                
                applySettings(fid, elid, { pan: this.value }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
                this.parentElement.querySelector('.element-pan').value = '' + this.value
            })
            
            const mono = node.querySelector('.element-mono')
            mono.checked = settings.mono || false
            mono.addEventListener('change', _ => {
                applySettings(fid, elid, { mono: mono.checked }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
            })
            
            const flip = node.querySelector('.element-flip')
            flip.checked = settings.flip || false
            flip.addEventListener('change', _ => {
                applySettings(fid, elid, { flip: flip.checked }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
            })
            
            node.querySelector('.element-reset').onclick = function () {
                gain.value = 1
                gainNumberInput.value = '' + gain.value
                pan.value = 0
                panNumberInput.value = '' + pan.value
                mono.checked = false
                flip.checked = false
                applySettings(fid, elid, { gain: 1, pan: 0, mono: false, flip: false }).then(results => {
                    if (results && results[0] && results[0].result && results[0].result.error) {
                        console.error('Apply settings error:', results[0].result.error);
                    }
                });
            }
            
            elementsList.appendChild(node)
            elCount += 1
        }
    }
    
    if (elCount == 0) {
        allElements.innerHTML = 'No audio/video found in the current tab. Note that some websites do not work because of cross-domain security restrictions.'
        indivElements.remove()
    } else {
        const node = document.createElement('div')
        node.appendChild(document.importNode(elementsTpl.content, true))
        node.querySelector('.element-label').textContent = `All media on the page`
        
        const gain = node.querySelector('.element-gain')
        const gainNumberInput = node.querySelector('.element-gain-num')
        gain.value = 1
        gainNumberInput.value = '' + gain.value
        
        function applyGain (value) {
            for (const [fid, els] of frameMap) {
                for (const [elid, el] of els) {
                    applySettings(fid, elid, { gain: value })
                    const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`)
                    if (egain) {
                        egain.value = value
                        egain.parentElement.querySelector('.element-gain-num').value = '' + value
                    }
                }
            }
            gain.value = value
            gainNumberInput.value = '' + value
        }
        
        gain.addEventListener('input', _ => applyGain(gain.value))
        gainNumberInput.addEventListener('input', function () {
            if (+this.value > +this.getAttribute('max'))
                this.value = this.getAttribute('max')
            if (+this.value < +this.getAttribute('min'))
                this.value = this.getAttribute('min')
            applyGain(+this.value)
        })
        
        const pan = node.querySelector('.element-pan')
        const panNumberInput = node.querySelector('.element-pan-num')
        pan.value = 0
        panNumberInput.value = '' + pan.value
        
        function applyPan (value) {
            for (const [fid, els] of frameMap) {
                for (const [elid, el] of els) {
                    applySettings(fid, elid, { pan: value })
                    const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`)
                    if (epan) {
                        epan.value = value
                        epan.parentElement.querySelector('.element-pan-num').value = '' + value
                    }
                }
            }
            pan.value = value
            panNumberInput.value = '' + value
        }
        
        pan.addEventListener('input', _ => applyPan(pan.value))
        panNumberInput.addEventListener('input', function () {
            if (+this.value > +this.getAttribute('max'))
                this.value = this.getAttribute('max')
            if (+this.value < +this.getAttribute('min'))
                this.value = this.getAttribute('min')
            applyPan(+this.value)
        })
        
        const mono = node.querySelector('.element-mono')
        mono.checked = false
        mono.addEventListener('change', _ => {
            for (const [fid, els] of frameMap) {
                for (const [elid, el] of els) {
                    applySettings(fid, elid, { mono: mono.checked })
                    const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`)
                    if (emono) emono.checked = mono.checked
                }
            }
        })
        
        const flip = node.querySelector('.element-flip')
        flip.checked = false
        flip.addEventListener('change', _ => {
            for (const [fid, els] of frameMap) {
                for (const [elid, el] of els) {
                    applySettings(fid, elid, { flip: flip.checked })
                    const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`)
                    if (eflip) eflip.checked = flip.checked
                }
            }
        })
        
        node.querySelector('.element-reset').onclick = function () {
            gain.value = 1
            gainNumberInput.value = '' + gain.value
            pan.value = 0
            panNumberInput.value = '' + pan.value
            mono.checked = false
            flip.checked = false
            
            for (const [fid, els] of frameMap) {
                for (const [elid, el] of els) {
                    const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`)
                    const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`)
                    const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`)
                    const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`)
                    
                    if (egain) {
                        egain.value = 1
                        egain.parentElement.querySelector('.element-gain-num').value = '1'
                    }
                    if (epan) {
                        epan.value = 0
                        epan.parentElement.querySelector('.element-pan-num').value = '0'
                    }
                    if (emono) emono.checked = false
                    if (eflip) eflip.checked = false
                    
                    applySettings(fid, elid, { gain: 1, pan: 0, mono: false, flip: false })
                }
            }
        }
        
        allElements.appendChild(node)
    }
}).catch(error => {
    console.error('Extension error:', error);
    allElements.innerHTML = `Error loading extension: ${error.message}. Please reload the page and try again.`;
    if (indivElements) indivElements.remove();
})
