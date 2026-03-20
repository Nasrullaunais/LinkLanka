import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebView from 'react-native-webview';
import {
  askDocumentQuestion,
  API_BASE_URL,
  type QAChatTurn,
  type QACitation,
} from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';

// PDF panel occupies ~42 % of the screen; the chat panel takes the rest and
// shrinks correctly when the soft keyboard opens.
const PDF_PANEL_HEIGHT = Math.round(Dimensions.get('window').height * 0.42);

// ── Types ────────────────────────────────────────────────────────────────────

interface QAMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  citations?: QACitation[];
}

interface DocumentInterrogationModalProps {
  visible: boolean;
  messageId: string;
  fileUrl: string;
  /** Optional initial page to scroll to (from summary bullet tap). */
  initialPage?: number;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function storageKey(messageId: string): string {
  return `doc-qa-${messageId}`;
}

function generateId(): string {
  return 'xxxxxxxx'.replace(/[x]/g, () =>
    ((Math.random() * 16) | 0).toString(16),
  );
}

function extractFilename(url: string): string {
  const segments = url.split('/');
  const raw = segments[segments.length - 1] ?? 'Document';
  if (raw.length > 40) {
    const ext = raw.split('.').pop() ?? '';
    return `Document.${ext}`;
  }
  return raw;
}

function extractOrigin(url: string): string {
  // e.g. "http://192.168.1.5:3000/media/uploads/doc.pdf" → "http://192.168.1.5:3000"
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : '';
}

/**
 * Rewrite the origin of a stored file URL to match the currently-configured
 * API base URL. Handles cases where the URL was stored with a different IP
 * (e.g. localhost, old network IP) than the device can currently reach.
 */
function normalizeFileUrl(url: string): string {
  const storedOrigin = extractOrigin(url);
  const currentOrigin = extractOrigin(API_BASE_URL);
  if (!storedOrigin || !currentOrigin || storedOrigin === currentOrigin) {
    return url;
  }
  return url.replace(storedOrigin, currentOrigin);
}

// ── PDF.js WebView HTML builder ──────────────────────────────────────────────
function buildPdfViewerHtml(pdfUrl: string): string {
  const safeUrl = pdfUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#f3f4f6}
#c{width:100%;height:100vh;overflow-y:scroll;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch}
.pw{width:100%;min-height:100vh;scroll-snap-align:start;display:flex;align-items:center;justify-content:center;background:#f3f4f6;padding:2px 0}
canvas{display:block;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
#ld{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-family:system-ui,sans-serif;color:#6b7280;font-size:14px}
</style></head><body>
<div id="c"></div><div id="ld">Loading document\u2026</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var cur=1,els=[];
async function run(){try{
var pdf=await pdfjsLib.getDocument('${safeUrl}').promise;
document.getElementById('ld').style.display='none';
var ct=document.getElementById('c');
window.ReactNativeWebView.postMessage(JSON.stringify({type:'loaded',pages:pdf.numPages}));
for(var i=1;i<=pdf.numPages;i++){var pg=await pdf.getPage(i);
var uv=pg.getViewport({scale:1});var s=window.innerWidth/uv.width;var rs=s*(window.devicePixelRatio||2);var vp=pg.getViewport({scale:rs});
var w=document.createElement('div');w.className='pw';w.id='p'+i;w.dataset.pg=String(i);
var cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
cv.style.width=window.innerWidth+'px';cv.style.height=Math.round(uv.height*s)+'px';
w.appendChild(cv);ct.appendChild(w);els.push(w);
await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;}
var ob=new IntersectionObserver(function(en){var b=0,bp=cur;
for(var j=0;j<en.length;j++){if(en[j].intersectionRatio>b){b=en[j].intersectionRatio;bp=+(en[j].target.dataset.pg)}}
if(bp!==cur&&b>.3){cur=bp;window.ReactNativeWebView.postMessage(JSON.stringify({type:'page',page:cur}))}}
,{root:ct,threshold:[.3,.5,.7]});
for(var k=0;k<els.length;k++)ob.observe(els[k]);
}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',msg:e.message||'PDF load failed'}))}}
window.goToPage=function(p){var el=document.getElementById('p'+p);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})};
run();
<\/script></body></html>`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DocumentInterrogationModal({
  visible,
  messageId,
  fileUrl,
  initialPage,
  onClose,
}: DocumentInterrogationModalProps) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const flatListRef = useRef<FlatList<QAMessage>>(null);
  const initialPageRef = useRef(initialPage);
  const [qaMessages, setQaMessages] = useState<QAMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [androidKeyboardOffset, setAndroidKeyboardOffset] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfError, setPdfError] = useState(false);
  const { colors } = useTheme();

  // ── Reset state when modal opens ───────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setPdfError(false);
      setCurrentPage(1);
      setTotalPages(0);
      setAndroidKeyboardOffset(0);
    }
  }, [visible]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardHeight = event.endCoordinates?.height ?? 0;
      setAndroidKeyboardOffset(Math.max(0, keyboardHeight));
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardOffset(0);
    });

    return () => {
      setAndroidKeyboardOffset(0);
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  // ── Persist / Restore Q&A history ──────────────────────────────────────
  useEffect(() => {
    if (!visible || !messageId) return;
    AsyncStorage.getItem(storageKey(messageId)).then((raw) => {
      if (raw) {
        try {
          setQaMessages(JSON.parse(raw));
        } catch {
          // corrupted data — ignore
        }
      }
    });
  }, [visible, messageId]);

  const persistHistory = useCallback(
    (messages: QAMessage[]) => {
      AsyncStorage.setItem(storageKey(messageId), JSON.stringify(messages)).catch(
        () => {},
      );
    },
    [messageId],
  );

  // Keep initial page ref in sync for onMessage handler
  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  // ── Ask question ───────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const question = inputText.trim();
    if (!question || isAsking) return;

    const userMsg: QAMessage = {
      id: generateId(),
      role: 'user',
      text: question,
    };

    const nextMessages = [...qaMessages, userMsg];
    setQaMessages(nextMessages);
    setInputText('');

    // Build chat history for the API (exclude the current question)
    const chatHistory: QAChatTurn[] = qaMessages.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    setIsAsking(true);
    try {
      const response = await askDocumentQuestion(messageId, question, chatHistory);

      const aiMsg: QAMessage = {
        id: generateId(),
        role: 'ai',
        text: response.answer,
        citations: response.citations,
      };

      const updated = [...nextMessages, aiMsg];
      setQaMessages(updated);
      persistHistory(updated);
      // onContentSizeChange on the FlatList handles scrolling to bottom
    } catch {
      const errorMsg: QAMessage = {
        id: generateId(),
        role: 'ai',
        text: 'Sorry, I couldn\'t process your question. Please try again.',
      };
      const updated = [...nextMessages, errorMsg];
      setQaMessages(updated);
      persistHistory(updated);
    } finally {
      setIsAsking(false);
    }
  }, [inputText, isAsking, qaMessages, messageId, persistHistory]);

  // ── Navigate to page (from citation tap — via WebView) ─────────────────
  const goToPage = useCallback((page: number) => {
    webViewRef.current?.injectJavaScript(`window.goToPage(${page}); true;`);
  }, []);

  // ── Handle messages from PDF.js WebView ─────────────────────────────────
  const handleWebViewMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        switch (data.type) {
          case 'loaded':
            setTotalPages(data.pages);
            if (initialPageRef.current && initialPageRef.current > 1) {
              setTimeout(() => {
                webViewRef.current?.injectJavaScript(
                  `window.goToPage(${initialPageRef.current}); true;`,
                );
              }, 400);
            }
            break;
          case 'page':
            setCurrentPage(data.page);
            break;
          case 'error':
            console.error('[DocInterrogation] PDF.js error:', data.msg);
            setPdfError(true);
            break;
        }
      } catch {
        // ignore malformed messages
      }
    },
    [],
  );

  // ── Handle close: persist and reset ────────────────────────────────────
  const handleClose = useCallback(() => {
    persistHistory(qaMessages);
    onClose();
  }, [qaMessages, persistHistory, onClose]);

  // ── Render Q&A message ─────────────────────────────────────────────────
  const renderQAMessage = useCallback(
    ({ item }: { item: QAMessage }) => {
      const isUser = item.role === 'user';
      return (
        <View
          style={[
            styles.qaBubble,
            isUser
              ? [styles.qaBubbleUser, { backgroundColor: colors.primary }]
              : [styles.qaBubbleAi, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }],
          ]}
        >
          {!isUser && (
            <View style={styles.aiLabel}>
              <Text style={[styles.aiLabelText, { color: colors.primary }]}>✨ AI</Text>
            </View>
          )}
          <Text
            style={[
              styles.qaText,
              isUser ? styles.qaTextUser : [styles.qaTextAi, { color: colors.text }],
            ]}
          >
            {item.text}
          </Text>
          {item.citations && item.citations.length > 0 && (
            <View style={styles.citationsContainer}>
              {item.citations.map((cit, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => goToPage(cit.page)}
                  style={({ pressed }) => [
                    styles.citationChip,
                    { backgroundColor: colors.primaryFaded },
                    pressed && styles.citationChipPressed,
                  ]}
                >
                  <Ionicons name="document-text-outline" size={12} color={colors.primary} />
                  <Text style={[styles.citationPage, { color: colors.primary }]}>p. {cit.page}</Text>
                  <Text style={[styles.citationExcerpt, { color: colors.textSecondary }]} numberOfLines={1}>
                    {cit.excerpt}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      );
    },
    [goToPage, colors],
  );

  const resolvedFileUrl = normalizeFileUrl(fileUrl);
  const filename = extractFilename(resolvedFileUrl);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
      >
        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleContainer}>
            <Ionicons name="document-text" size={18} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {filename}
            </Text>
          </View>
          {totalPages > 0 && (
            <Text style={[styles.pageIndicator, { color: colors.textSecondary }]}>
              {currentPage}/{totalPages}
            </Text>
          )}
        </View>

        {/* ── Top half: PDF viewer ── */}
        <View style={[styles.pdfContainer, { backgroundColor: colors.surface }]}>
          {pdfError ? (
            <View style={styles.pdfErrorContainer}>
              <Ionicons name="alert-circle-outline" size={48} color={colors.emptyIcon} />
              <Text style={[styles.pdfErrorText, { color: colors.emptyText }]}>
                Unable to render document preview
              </Text>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              source={{ html: buildPdfViewerHtml(resolvedFileUrl), baseUrl: extractOrigin(resolvedFileUrl) }}
              originWhitelist={['*']}
              javaScriptEnabled
              mixedContentMode="always"
              allowFileAccess
              allowUniversalAccessFromFileURLs
              onMessage={handleWebViewMessage}
              onError={() => setPdfError(true)}
              style={styles.pdf}
            />
          )}
        </View>

        {/* ── Divider ── */}
        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        {/* ── Bottom half: Private AI chat ── */}
        <View style={[styles.chatContainer, { backgroundColor: colors.surface }]}>
          {qaMessages.length === 0 ? (
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatIcon}>🤖</Text>
              <Text style={[styles.emptyChatTitle, { color: colors.text }]}>Document Assistant</Text>
              <Text style={[styles.emptyChatSubtitle, { color: colors.textSecondary }]}>
                Ask any question about this document.{'\n'}
                Tap citation chips to jump to the source.
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={qaMessages}
              keyExtractor={(item) => item.id}
              renderItem={renderQAMessage}
              contentContainerStyle={styles.chatList}
              removeClippedSubviews
              initialNumToRender={10}
              windowSize={5}
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({ animated: true })
              }
            />
          )}

          {/* ── Loading indicator ── */}
          {isAsking && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.spinnerColor} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Thinking…</Text>
            </View>
          )}

          {/* ── Input bar ── */}
          <View style={[styles.inputBar, {
            paddingBottom: Math.max(insets.bottom, 8),
            marginBottom: Platform.OS === 'android' ? androidKeyboardOffset : 0,
            backgroundColor: colors.inputWrapperBg,
            borderTopColor: colors.inputBorder,
          }]}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.inputText }]}
              placeholder="Ask AI about this document…"
              placeholderTextColor={colors.inputPlaceholder}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              editable={!isAsking}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={handleSend}
              disabled={!inputText.trim() || isAsking}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: colors.primary },
                (!inputText.trim() || isAsking) && { backgroundColor: colors.primaryLight, opacity: 0.7 },
                pressed && styles.sendBtnPressed,
              ]}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  closeBtn: {
    padding: 4,
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  pageIndicator: {
    fontSize: 13,
    fontWeight: '500',
  },
  // ── PDF
  pdfContainer: {
    height: PDF_PANEL_HEIGHT,
  },
  pdf: {
    flex: 1,
  },
  pdfErrorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  pdfErrorText: {
    fontSize: 14,
  },
  // ── Divider
  divider: {
    height: 3,
  },
  // ── Chat
  chatContainer: {
    flex: 1,
  },
  chatList: {
    padding: 12,
    gap: 8,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyChatIcon: {
    fontSize: 40,
  },
  emptyChatTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyChatSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  // ── Q&A bubbles
  qaBubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    marginBottom: 4,
  },
  qaBubbleUser: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  qaBubbleAi: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiLabel: {
    marginBottom: 4,
  },
  aiLabelText: {
    fontSize: 11,
    fontWeight: '600',
  },
  qaText: {
    fontSize: 14,
    lineHeight: 20,
  },
  qaTextUser: {
    color: '#fff',
  },
  qaTextAi: {
  },
  // ── Citations
  citationsContainer: {
    marginTop: 8,
    gap: 4,
  },
  citationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  citationChipPressed: {
    opacity: 0.7,
  },
  citationPage: {
    fontSize: 11,
    fontWeight: '700',
  },
  citationExcerpt: {
    fontSize: 11,
    flex: 1,
  },
  // ── Loading
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  loadingText: {
    fontSize: 13,
  },
  // ── Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: {
    opacity: 0.8,
  },
});
