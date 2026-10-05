use blitz_shell::{BlitzApplication, View};
use dioxus_core::{provide_context, ScopeId};
use dioxus_history::{History, MemoryHistory};
use std::rc::Rc;
use winit::application::ApplicationHandler;
use winit::event::{StartCause, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoopProxy};
use winit::window::WindowId;

use crate::DioxusNativeWindowRenderer;
use crate::{contexts::DioxusNativeDocument, BlitzShellEvent, DioxusDocument, WindowConfig};

/// Dioxus-native specific event type
pub enum DioxusNativeEvent {
    /// A hotreload event, basically telling us to update our templates.
    #[cfg(all(
        feature = "hot-reload",
        debug_assertions,
        not(target_os = "android"),
        not(target_os = "ios")
    ))]
    DevserverEvent(dioxus_devtools::DevserverMsg),

    /// Create a new head element from the Link and Title elements
    ///
    /// todo(jon): these should probabkly be synchronous somehow
    CreateHeadElement {
        window: WindowId,
        name: String,
        attributes: Vec<(String, String)>,
        contents: Option<String>,
    },

    /// Request an immediate window redraw from any thread via EventLoopProxy
    RequestRedraw {
        window: WindowId,
    },
}

pub struct DioxusNativeApplication {
    pending_window: Option<WindowConfig<DioxusNativeWindowRenderer>>,
    inner: BlitzApplication<DioxusNativeWindowRenderer>,
    proxy: EventLoopProxy<BlitzShellEvent>,
}

impl DioxusNativeApplication {
    pub fn new(
        proxy: EventLoopProxy<BlitzShellEvent>,
        config: WindowConfig<DioxusNativeWindowRenderer>,
    ) -> Self {
        Self {
            pending_window: Some(config),
            inner: BlitzApplication::new(proxy.clone()),
            proxy,
        }
    }

    pub fn add_window(&mut self, window_config: WindowConfig<DioxusNativeWindowRenderer>) {
        self.inner.add_window(window_config);
    }

    /// Keep keyboard events inside the active application surface.
    ///
    /// Blitz can retain focus on a detached node after Dioxus replaces a
    /// conditional subtree. Keyboard events are then delivered to an orphaned
    /// chain and never reach an `onkeydown` listener. Select the highest active
    /// keyboard scope before forwarding the Winit event, while preserving focus
    /// when it is already inside that scope (notably for text inputs).
    fn repair_keyboard_focus(&mut self, window_id: WindowId) {
        let Some(window) = self.inner.windows.get_mut(&window_id) else {
            return;
        };
        let doc = window.downcast_doc_mut::<DioxusDocument>();
        let mut desired = None::<(u8, usize)>;

        doc.inner.visit(|node_id, node| {
            if !node.flags.is_in_document() {
                return;
            }
            let Some(element) = node.element_data() else {
                return;
            };
            let Some(class) = element
                .attrs
                .iter()
                .find(|attr| attr.name.local.as_ref() == "class")
                .map(|attr| attr.value.as_str())
            else {
                return;
            };

            let priority = class
                .split_ascii_whitespace()
                .filter_map(|name| match name {
                    "quality-layer" => Some(60),
                    "settings-dialog" => Some(50),
                    "queue-panel" => Some(40),
                    "video-player-root" => Some(30),
                    "full-player" => Some(20),
                    "vault-shell" => Some(10),
                    _ => None,
                })
                .max()
                .unwrap_or(0);

            if priority > desired.map_or(0, |(best, _)| best) {
                desired = Some((priority, node_id));
            }
        });

        let Some((_, desired_id)) = desired else {
            return;
        };
        let already_in_scope = doc
            .inner
            .get_focussed_node_id()
            .is_some_and(|focused_id| {
                doc.inner
                    .get_node(focused_id)
                    .is_some_and(|node| node.flags.is_in_document())
                    && doc.inner.node_chain(focused_id).contains(&desired_id)
            });

        if !already_in_scope {
            doc.inner.set_focus_to(desired_id);
        }
    }

    fn handle_blitz_shell_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        event: &DioxusNativeEvent,
    ) {
        match event {
            #[cfg(all(
                feature = "hot-reload",
                debug_assertions,
                not(target_os = "android"),
                not(target_os = "ios")
            ))]
            DioxusNativeEvent::DevserverEvent(event) => match event {
                dioxus_devtools::DevserverMsg::HotReload(hotreload_message) => {
                    for window in self.inner.windows.values_mut() {
                        let doc = window.downcast_doc_mut::<DioxusDocument>();

                        // Apply changes to vdom
                        dioxus_devtools::apply_changes(&doc.vdom, hotreload_message);

                        // Reload changed assets
                        for asset_path in &hotreload_message.assets {
                            if let Some(url) = asset_path.to_str() {
                                doc.reload_resource_by_href(url);
                            }
                        }

                        window.poll();
                    }
                }
                dioxus_devtools::DevserverMsg::Shutdown => event_loop.exit(),
                dioxus_devtools::DevserverMsg::FullReloadStart => {}
                dioxus_devtools::DevserverMsg::FullReloadFailed => {}
                dioxus_devtools::DevserverMsg::FullReloadCommand => {}
                _ => {}
            },

            DioxusNativeEvent::CreateHeadElement {
                name,
                attributes,
                contents,
                window,
            } => {
                if let Some(window) = self.inner.windows.get_mut(window) {
                    let doc = window.downcast_doc_mut::<DioxusDocument>();
                    doc.create_head_element(name, attributes, contents);
                    window.poll();
                }
            }

            DioxusNativeEvent::RequestRedraw { window } => {
                if let Some(window) = self.inner.windows.get_mut(window) {
                    window.request_redraw();
                }
            }

            // Suppress unused variable warning
            #[cfg(not(all(
                feature = "hot-reload",
                debug_assertions,
                not(target_os = "android"),
                not(target_os = "ios")
            )))]
            #[allow(unreachable_patterns)]
            _ => {
                let _ = event_loop;
                let _ = event;
            }
        }
    }
}

impl ApplicationHandler<BlitzShellEvent> for DioxusNativeApplication {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        #[cfg(feature = "tracing")]
        tracing::debug!("Injecting document provider into all windows");

        if let Some(config) = self.pending_window.take() {
            let mut window = View::init(config, event_loop, &self.proxy);
            let renderer = window.renderer.clone();
            let window_id = window.window_id();
            let native_window = window.window.clone();
            let doc = window.downcast_doc_mut::<DioxusDocument>();

            doc.vdom.in_scope(ScopeId::ROOT, || {
                let shared: Rc<dyn dioxus_document::Document> =
                    Rc::new(DioxusNativeDocument::new(self.proxy.clone(), window_id));
                provide_context(shared);
            });

            // Add history
            let history_provider: Rc<dyn History> = Rc::new(MemoryHistory::default());
            doc.vdom
                .in_scope(ScopeId::ROOT, move || provide_context(history_provider));

            // Add renderer
            doc.vdom
                .in_scope(ScopeId::ROOT, move || provide_context(renderer));

            // Let native Dioxus components request window-level behavior such
            // as borderless fullscreen. Upstream currently exposes the GPU
            // renderer but not its owning Winit window.
            doc.vdom
                .in_scope(ScopeId::ROOT, move || provide_context(native_window));

            // Thread-safe redraw trigger via EventLoopProxy
            let redraw_handle = crate::contexts::WindowRedrawHandle::new(self.proxy.clone(), window_id);
            doc.vdom
                .in_scope(ScopeId::ROOT, move || provide_context(redraw_handle));

            // Queue rebuild
            doc.initial_build();

            // And then request redraw
            window.request_redraw();

            // todo(jon): we should actually mess with the pending windows instead of passing along the contexts
            self.inner.windows.insert(window_id, window);
        }

        self.inner.resumed(event_loop);
    }

    fn suspended(&mut self, event_loop: &ActiveEventLoop) {
        self.inner.suspended(event_loop);
    }

    fn new_events(&mut self, event_loop: &ActiveEventLoop, cause: StartCause) {
        self.inner.new_events(event_loop, cause);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if matches!(&event, WindowEvent::KeyboardInput { .. }) {
            self.repair_keyboard_focus(window_id);
        }
        self.inner.window_event(event_loop, window_id, event);
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: BlitzShellEvent) {
        match event {
            BlitzShellEvent::Embedder(event) => {
                if let Some(event) = event.downcast_ref::<DioxusNativeEvent>() {
                    self.handle_blitz_shell_event(event_loop, event);
                }
            }
            event => self.inner.user_event(event_loop, event),
        }
    }
}
