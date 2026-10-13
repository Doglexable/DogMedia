use dioxus_native::{CustomPaintCtx, CustomPaintSource, DeviceHandle, TextureHandle};
use std::time::{Duration, Instant};
use wgpu::{
    BindGroup, BindGroupDescriptor, BindGroupEntry, BindGroupLayout, BindGroupLayoutDescriptor,
    BindGroupLayoutEntry, BindingResource, BindingType, Buffer, BufferBindingType,
    BufferDescriptor, BufferUsages, Color, ColorTargetState, ColorWrites, CommandEncoderDescriptor,
    Extent3d, FilterMode, FragmentState, MultisampleState, Operations, Origin3d,
    PipelineCompilationOptions, PipelineLayoutDescriptor, PrimitiveState, PrimitiveTopology,
    RenderPassColorAttachment, RenderPassDescriptor, RenderPipeline, RenderPipelineDescriptor,
    Sampler, SamplerBindingType, SamplerDescriptor, ShaderModuleDescriptor, ShaderSource,
    TexelCopyBufferLayout, TexelCopyTextureInfo, TextureAspect, TextureDescriptor,
    TextureDimension, TextureFormat, TextureSampleType, TextureUsages, TextureViewDescriptor,
    TextureViewDimension, VertexState,
};

use crate::playback::{VideoFrameReceiver, VideoPixelFormat};

const NV12_WGSL: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct ScaleUniform {
    scale: vec2<f32>,
    offset: vec2<f32>,
    color_standard: u32,
    source_width: f32,
    source_height: f32,
    is_upscaling: u32,
};

@group(0) @binding(3)
var<uniform> u_transform: ScaleUniform;

fn smooth_uv(uv: vec2<f32>, tex_size: vec2<f32>) -> vec2<f32> {
    let texel = uv * tex_size - 0.5;
    let f = fract(texel);
    let smooth_f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return (floor(texel) + 0.5 + smooth_f) / tex_size;
}

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0)
    );
    var uv = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[in_vertex_index] * u_transform.scale + u_transform.offset, 0.0, 1.0);
    out.uv = uv[in_vertex_index];
    return out;
}

@group(0) @binding(0)
var t_y: texture_2d<f32>;
@group(0) @binding(1)
var t_uv: texture_2d<f32>;
@group(0) @binding(2)
var s_diffuse: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var sample_uv = in.uv;
    if (u_transform.is_upscaling == 1u && u_transform.source_width > 0.0 && u_transform.source_height > 0.0) {
        sample_uv = smooth_uv(in.uv, vec2<f32>(u_transform.source_width, u_transform.source_height));
    }
    let y_raw = textureSample(t_y, s_diffuse, sample_uv).r;
    let uv_raw = textureSample(t_uv, s_diffuse, sample_uv).rg;

    // Standard video studio swing normalization:
    // Y in [16, 235] -> [0.0, 1.0]
    // UV in [16, 240] centered at 128 -> [-0.5, 0.5]
    let y = clamp((y_raw - (16.0 / 255.0)) * (255.0 / (235.0 - 16.0)), 0.0, 1.0);
    let u = (uv_raw.r - (128.0 / 255.0)) * (255.0 / (240.0 - 16.0));
    let v = (uv_raw.g - (128.0 / 255.0)) * (255.0 / (240.0 - 16.0));

    var r: f32;
    var g: f32;
    var b: f32;

    if (u_transform.color_standard == 1u) {
        // ITU-R BT.601 (SD video standard)
        r = y + 1.402 * v;
        g = y - 0.344136 * u - 0.714136 * v;
        b = y + 1.772 * u;
    } else {
        // ITU-R BT.709 (HD/FHD video standard)
        r = y + 1.5748 * v;
        g = y - 0.187324 * u - 0.468124 * v;
        b = y + 1.8556 * u;
    }

    return vec4<f32>(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), 1.0);
}
"#;

const RGBA_WGSL: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct ScaleUniform {
    scale: vec2<f32>,
    offset: vec2<f32>,
    color_standard: u32,
    source_width: f32,
    source_height: f32,
    is_upscaling: u32,
};

@group(0) @binding(2)
var<uniform> u_transform: ScaleUniform;

fn smooth_uv(uv: vec2<f32>, tex_size: vec2<f32>) -> vec2<f32> {
    let texel = uv * tex_size - 0.5;
    let f = fract(texel);
    let smooth_f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return (floor(texel) + 0.5 + smooth_f) / tex_size;
}

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0)
    );
    var uv = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[in_vertex_index] * u_transform.scale + u_transform.offset, 0.0, 1.0);
    out.uv = uv[in_vertex_index];
    return out;
}

@group(0) @binding(0)
var t_diffuse: texture_2d<f32>;
@group(0) @binding(1)
var s_diffuse: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var sample_uv = in.uv;
    if (u_transform.is_upscaling == 1u && u_transform.source_width > 0.0 && u_transform.source_height > 0.0) {
        sample_uv = smooth_uv(in.uv, vec2<f32>(u_transform.source_width, u_transform.source_height));
    }
    return textureSample(t_diffuse, s_diffuse, sample_uv);
}
"#;

struct Nv12Resources {
    pipeline: RenderPipeline,
    bind_group_layout: BindGroupLayout,
    sampler: Sampler,
    uniform_buffer: Buffer,
}

impl Nv12Resources {
    fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("dogmedia-nv12-scaler-shader"),
            source: ShaderSource::Wgsl(NV12_WGSL.into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("dogmedia-nv12-scaler-bgl"),
            entries: &[
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("dogmedia-nv12-scaler-pl"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
            label: Some("dogmedia-nv12-scaler-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: PipelineCompilationOptions::default(),
            },
            primitive: PrimitiveState {
                topology: PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: MultisampleState::default(),
            fragment: Some(FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(ColorTargetState {
                    format: TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
                compilation_options: PipelineCompilationOptions::default(),
            }),
            multiview: None,
            cache: None,
        });
        let sampler = device.create_sampler(&SamplerDescriptor {
            label: Some("dogmedia-nv12-scaler-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: FilterMode::Linear,
            min_filter: FilterMode::Linear,
            mipmap_filter: FilterMode::Nearest,
            ..Default::default()
        });
        let uniform_buffer = device.create_buffer(&BufferDescriptor {
            label: Some("dogmedia-nv12-scaler-uniforms"),
            size: 32,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            pipeline,
            bind_group_layout,
            sampler,
            uniform_buffer,
        }
    }
}

struct RgbaResources {
    pipeline: RenderPipeline,
    bind_group_layout: BindGroupLayout,
    sampler: Sampler,
    uniform_buffer: Buffer,
}

impl RgbaResources {
    fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("dogmedia-rgba-scaler-shader"),
            source: ShaderSource::Wgsl(RGBA_WGSL.into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("dogmedia-rgba-scaler-bgl"),
            entries: &[
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("dogmedia-rgba-scaler-pl"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
            label: Some("dogmedia-rgba-scaler-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: PipelineCompilationOptions::default(),
            },
            primitive: PrimitiveState {
                topology: PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: MultisampleState::default(),
            fragment: Some(FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(ColorTargetState {
                    format: TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
                compilation_options: PipelineCompilationOptions::default(),
            }),
            multiview: None,
            cache: None,
        });
        let sampler = device.create_sampler(&SamplerDescriptor {
            label: Some("dogmedia-rgba-scaler-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: FilterMode::Linear,
            min_filter: FilterMode::Linear,
            mipmap_filter: FilterMode::Nearest,
            ..Default::default()
        });
        let uniform_buffer = device.create_buffer(&BufferDescriptor {
            label: Some("dogmedia-rgba-scaler-uniforms"),
            size: 32,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            pipeline,
            bind_group_layout,
            sampler,
            uniform_buffer,
        }
    }
}

pub struct VideoPaintSource {
    frames: VideoFrameReceiver,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    nv12_scaler: Option<Nv12Resources>,
    rgba_scaler: Option<RgbaResources>,

    y_texture: Option<wgpu::Texture>,
    uv_texture: Option<wgpu::Texture>,
    nv12_bind_group: Option<BindGroup>,

    rgba_texture: Option<wgpu::Texture>,
    rgba_bind_group: Option<BindGroup>,

    frame_size: Option<(u32, u32)>,
    frame_format: Option<VideoPixelFormat>,

    target_texture: Option<wgpu::Texture>,
    target_texture_handle: Option<TextureHandle>,
    target_size: Option<(u32, u32)>,

    fps_window_started_at: Instant,
    fps_session_started_at: Option<Instant>,
    fps_last_frame_at: Option<Instant>,
    fps_window_frames: u64,
    fps_session_frames: u64,
    render_window_calls: u64,
    produced_window_start: u64,
}

impl VideoPaintSource {
    pub fn new(frames: VideoFrameReceiver) -> Self {
        let now = Instant::now();
        Self {
            frames,
            device: None,
            queue: None,
            nv12_scaler: None,
            rgba_scaler: None,
            y_texture: None,
            uv_texture: None,
            nv12_bind_group: None,
            rgba_texture: None,
            rgba_bind_group: None,
            frame_size: None,
            frame_format: None,
            target_texture: None,
            target_texture_handle: None,
            target_size: None,
            fps_window_started_at: now,
            fps_session_started_at: None,
            fps_last_frame_at: None,
            fps_window_frames: 0,
            fps_session_frames: 0,
            render_window_calls: 0,
            produced_window_start: crate::playback::produced_frames(),
        }
    }

    fn record_uploaded_frame(&mut self, source_size: (u32, u32), target_size: (u32, u32)) {
        let now = Instant::now();
        if self
            .fps_last_frame_at
            .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(2))
        {
            self.fps_window_started_at = now;
            self.fps_session_started_at = Some(now);
            self.fps_window_frames = 0;
            self.fps_session_frames = 0;
            self.render_window_calls = 0;
            self.produced_window_start = crate::playback::produced_frames();
        }

        self.fps_last_frame_at = Some(now);
        self.fps_window_frames += 1;
        self.fps_session_frames += 1;

        let interval = now.duration_since(self.fps_window_started_at);
        if interval < Duration::from_secs(1) {
            return;
        }

        let produced_now = crate::playback::produced_frames();
        let produced_window = produced_now.saturating_sub(self.produced_window_start);
        let fps = self.fps_window_frames as f64 / interval.as_secs_f64();
        let session_elapsed = self
            .fps_session_started_at
            .map(|started| now.duration_since(started).as_secs_f64())
            .unwrap_or(interval.as_secs_f64());
        let average_fps = if session_elapsed > 0.0 {
            self.fps_session_frames as f64 / session_elapsed
        } else {
            0.0
        };
        tracing::info!(
            target: "dogmedia_desktop::video",
            fps = format_args!("{fps:.1}"),
            average_fps = format_args!("{average_fps:.1}"),
            uploaded_frames = self.fps_session_frames,
            produced_window = produced_window,
            render_calls_window = self.render_window_calls,
            source_width = source_size.0,
            source_height = source_size.1,
            target_width = target_size.0,
            target_height = target_size.1,
            "video frame upload FPS"
        );

        self.fps_window_started_at = now;
        self.fps_window_frames = 0;
        self.render_window_calls = 0;
        self.produced_window_start = produced_now;
    }

    fn ensure_placeholder(&mut self, mut ctx: CustomPaintCtx<'_>) -> Option<TextureHandle> {
        if let Some(handle) = &self.target_texture_handle {
            return Some(handle.clone());
        }
        let device = self.device.as_ref()?;
        let queue = self.queue.as_ref()?;
        let texture = device.create_texture(&TextureDescriptor {
            label: Some("dogmedia-video-placeholder"),
            size: Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        queue.write_texture(
            TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            &[0, 0, 0, 255],
            TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        let handle = ctx.register_texture(texture.clone());
        self.target_texture_handle = Some(handle.clone());
        self.target_texture = Some(texture);
        self.target_size = Some((1, 1));
        Some(handle)
    }
}

impl CustomPaintSource for VideoPaintSource {
    fn resume(&mut self, device_handle: &DeviceHandle) {
        self.device = Some(device_handle.device.clone());
        self.queue = Some(device_handle.queue.clone());
        self.nv12_scaler = None;
        self.rgba_scaler = None;
        self.nv12_bind_group = None;
        self.rgba_bind_group = None;
    }

    fn suspend(&mut self) {
        self.target_texture = None;
        self.target_texture_handle = None;
        self.target_size = None;
        self.y_texture = None;
        self.uv_texture = None;
        self.nv12_bind_group = None;
        self.rgba_texture = None;
        self.rgba_bind_group = None;
        self.frame_size = None;
        self.frame_format = None;
        self.nv12_scaler = None;
        self.rgba_scaler = None;
        self.device = None;
        self.queue = None;
        self.fps_session_started_at = None;
        self.fps_last_frame_at = None;
        self.fps_window_frames = 0;
        self.fps_session_frames = 0;
    }

    fn render(
        &mut self,
        mut ctx: CustomPaintCtx<'_>,
        width: u32,
        height: u32,
        _scale: f64,
    ) -> Option<TextureHandle> {
        let render_started = Instant::now();
        self.render_window_calls += 1;
        let dest_w = width.max(1);
        let dest_h = height.max(1);

        let mut frame_updated = false;
        if let Some(frame) = self.frames.take_frame() {
            let width = frame.width;
            let height = frame.height;
            let format = frame.format;
            let uv_width = width.div_ceil(2);
            let uv_height = height.div_ceil(2);
            let y_total_bytes = (width * height) as usize;
            let uv_total_bytes = (uv_width * 2 * uv_height) as usize;

            let valid = match format {
                VideoPixelFormat::Nv12 => {
                    width > 0 && height > 0 && frame.pixels.len() == y_total_bytes + uv_total_bytes
                }
                VideoPixelFormat::Rgba => {
                    width > 0 && height > 0 && frame.pixels.len() == (width * height * 4) as usize
                }
            };

            if valid {
                let size_or_format_changed =
                    self.frame_size != Some((width, height)) || self.frame_format != Some(format);

                if size_or_format_changed {
                    let device = self.device.as_ref()?;
                    match format {
                        VideoPixelFormat::Nv12 => {
                            let y_tex = device.create_texture(&TextureDescriptor {
                                label: Some("dogmedia-nv12-y-frame"),
                                size: Extent3d {
                                    width,
                                    height,
                                    depth_or_array_layers: 1,
                                },
                                mip_level_count: 1,
                                sample_count: 1,
                                dimension: TextureDimension::D2,
                                format: TextureFormat::R8Unorm,
                                usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
                                view_formats: &[],
                            });
                            let uv_tex = device.create_texture(&TextureDescriptor {
                                label: Some("dogmedia-nv12-uv-frame"),
                                size: Extent3d {
                                    width: uv_width,
                                    height: uv_height,
                                    depth_or_array_layers: 1,
                                },
                                mip_level_count: 1,
                                sample_count: 1,
                                dimension: TextureDimension::D2,
                                format: TextureFormat::Rg8Unorm,
                                usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
                                view_formats: &[],
                            });
                            self.y_texture = Some(y_tex);
                            self.uv_texture = Some(uv_tex);
                            self.nv12_bind_group = None;
                        }
                        VideoPixelFormat::Rgba => {
                            let rgba_tex = device.create_texture(&TextureDescriptor {
                                label: Some("dogmedia-rgba-frame"),
                                size: Extent3d {
                                    width,
                                    height,
                                    depth_or_array_layers: 1,
                                },
                                mip_level_count: 1,
                                sample_count: 1,
                                dimension: TextureDimension::D2,
                                format: TextureFormat::Rgba8Unorm,
                                usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
                                view_formats: &[],
                            });
                            self.rgba_texture = Some(rgba_tex);
                            self.rgba_bind_group = None;
                        }
                    }
                    self.frame_size = Some((width, height));
                    self.frame_format = Some(format);
                }

                let queue = self.queue.as_ref()?;
                match format {
                    VideoPixelFormat::Nv12 => {
                        let y_tex = self.y_texture.as_ref()?;
                        let uv_tex = self.uv_texture.as_ref()?;

                        queue.write_texture(
                            TexelCopyTextureInfo {
                                texture: y_tex,
                                mip_level: 0,
                                origin: Origin3d::ZERO,
                                aspect: TextureAspect::All,
                            },
                            &frame.pixels[..y_total_bytes],
                            TexelCopyBufferLayout {
                                offset: 0,
                                bytes_per_row: Some(width),
                                rows_per_image: Some(height),
                            },
                            Extent3d {
                                width,
                                height,
                                depth_or_array_layers: 1,
                            },
                        );

                        queue.write_texture(
                            TexelCopyTextureInfo {
                                texture: uv_tex,
                                mip_level: 0,
                                origin: Origin3d::ZERO,
                                aspect: TextureAspect::All,
                            },
                            &frame.pixels[y_total_bytes..y_total_bytes + uv_total_bytes],
                            TexelCopyBufferLayout {
                                offset: 0,
                                bytes_per_row: Some(uv_width * 2),
                                rows_per_image: Some(uv_height),
                            },
                            Extent3d {
                                width: uv_width,
                                height: uv_height,
                                depth_or_array_layers: 1,
                            },
                        );
                    }
                    VideoPixelFormat::Rgba => {
                        let rgba_tex = self.rgba_texture.as_ref()?;
                        queue.write_texture(
                            TexelCopyTextureInfo {
                                texture: rgba_tex,
                                mip_level: 0,
                                origin: Origin3d::ZERO,
                                aspect: TextureAspect::All,
                            },
                            &frame.pixels,
                            TexelCopyBufferLayout {
                                offset: 0,
                                bytes_per_row: Some(width * 4),
                                rows_per_image: Some(height),
                            },
                            Extent3d {
                                width,
                                height,
                                depth_or_array_layers: 1,
                            },
                        );
                    }
                }
                frame_updated = true;
                self.record_uploaded_frame((width, height), (dest_w, dest_h));
            }
            self.frames.recycle_buffer(frame.pixels);
        }

        let mut target_updated = false;
        if self.target_size != Some((dest_w, dest_h)) {
            if let Some(handle) = self.target_texture_handle.take() {
                ctx.unregister_texture(handle);
            }
            let device = self.device.as_ref()?;
            let texture = device.create_texture(&TextureDescriptor {
                label: Some("dogmedia-video-target"),
                size: Extent3d {
                    width: dest_w,
                    height: dest_h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: TextureFormat::Rgba8Unorm,
                usage: TextureUsages::RENDER_ATTACHMENT
                    | TextureUsages::TEXTURE_BINDING
                    | TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            self.target_texture_handle = Some(ctx.register_texture(texture.clone()));
            self.target_texture = Some(texture);
            self.target_size = Some((dest_w, dest_h));
            target_updated = true;
        }

        if (frame_updated || target_updated)
            && let (Some(device), Some(queue), Some(target_texture), Some((fw, fh)), Some(format)) = (
                self.device.as_ref(),
                self.queue.as_ref(),
                self.target_texture.as_ref(),
                self.frame_size,
                self.frame_format,
            )
        {
            let fw = fw as f32;
            let fh = fh as f32;
            let tw = dest_w as f32;
            let th = dest_h as f32;
            let scale_factor = (tw / fw).min(th / fh);
            let fit_w = fw * scale_factor;
            let fit_h = fh * scale_factor;
            let scale_x = fit_w / tw;
            let scale_y = fit_h / th;

            let is_upscaling: u32 = if tw > fw * 1.05 || th > fh * 1.05 {
                1
            } else {
                0
            };
            let color_standard: u32 = if fh < 720.0 { 1 } else { 0 };
            let mut uniform_bytes = [0u8; 32];
            uniform_bytes[0..4].copy_from_slice(&scale_x.to_ne_bytes());
            uniform_bytes[4..8].copy_from_slice(&scale_y.to_ne_bytes());
            uniform_bytes[8..12].copy_from_slice(&0.0_f32.to_ne_bytes());
            uniform_bytes[12..16].copy_from_slice(&0.0_f32.to_ne_bytes());
            uniform_bytes[16..20].copy_from_slice(&color_standard.to_ne_bytes());
            uniform_bytes[20..24].copy_from_slice(&fw.to_ne_bytes());
            uniform_bytes[24..28].copy_from_slice(&fh.to_ne_bytes());
            uniform_bytes[28..32].copy_from_slice(&is_upscaling.to_ne_bytes());

            match format {
                VideoPixelFormat::Nv12 => {
                    if self.nv12_scaler.is_none() {
                        self.nv12_scaler = Some(Nv12Resources::new(device));
                    }
                    let Some(scaler) = self.nv12_scaler.as_ref() else {
                        return self.target_texture_handle.clone();
                    };
                    let (Some(y_tex), Some(uv_tex)) =
                        (self.y_texture.as_ref(), self.uv_texture.as_ref())
                    else {
                        return self.target_texture_handle.clone();
                    };

                    queue.write_buffer(&scaler.uniform_buffer, 0, &uniform_bytes);

                    if self.nv12_bind_group.is_none() {
                        let y_view = y_tex.create_view(&TextureViewDescriptor::default());
                        let uv_view = uv_tex.create_view(&TextureViewDescriptor::default());
                        let bind_group = device.create_bind_group(&BindGroupDescriptor {
                            label: Some("dogmedia-nv12-scaler-bg"),
                            layout: &scaler.bind_group_layout,
                            entries: &[
                                BindGroupEntry {
                                    binding: 0,
                                    resource: BindingResource::TextureView(&y_view),
                                },
                                BindGroupEntry {
                                    binding: 1,
                                    resource: BindingResource::TextureView(&uv_view),
                                },
                                BindGroupEntry {
                                    binding: 2,
                                    resource: BindingResource::Sampler(&scaler.sampler),
                                },
                                BindGroupEntry {
                                    binding: 3,
                                    resource: scaler.uniform_buffer.as_entire_binding(),
                                },
                            ],
                        });
                        self.nv12_bind_group = Some(bind_group);
                    }
                    let Some(bind_group) = self.nv12_bind_group.as_ref() else {
                        return self.target_texture_handle.clone();
                    };

                    let target_view = target_texture.create_view(&TextureViewDescriptor::default());
                    let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
                        label: Some("dogmedia-video-scaler-encoder"),
                    });
                    {
                        let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
                            label: Some("dogmedia-video-scaler-pass"),
                            color_attachments: &[Some(RenderPassColorAttachment {
                                view: &target_view,
                                resolve_target: None,
                                depth_slice: None,
                                ops: Operations {
                                    load: wgpu::LoadOp::Clear(Color::BLACK),
                                    store: wgpu::StoreOp::Store,
                                },
                            })],
                            depth_stencil_attachment: None,
                            timestamp_writes: None,
                            occlusion_query_set: None,
                        });
                        pass.set_pipeline(&scaler.pipeline);
                        pass.set_bind_group(0, bind_group, &[]);
                        pass.draw(0..6, 0..1);
                    }
                    queue.submit(Some(encoder.finish()));
                }
                VideoPixelFormat::Rgba => {
                    if self.rgba_scaler.is_none() {
                        self.rgba_scaler = Some(RgbaResources::new(device));
                    }
                    let Some(scaler) = self.rgba_scaler.as_ref() else {
                        return self.target_texture_handle.clone();
                    };
                    let Some(rgba_tex) = self.rgba_texture.as_ref() else {
                        return self.target_texture_handle.clone();
                    };

                    queue.write_buffer(&scaler.uniform_buffer, 0, &uniform_bytes);

                    if self.rgba_bind_group.is_none() {
                        let view = rgba_tex.create_view(&TextureViewDescriptor::default());
                        let bind_group = device.create_bind_group(&BindGroupDescriptor {
                            label: Some("dogmedia-rgba-scaler-bg"),
                            layout: &scaler.bind_group_layout,
                            entries: &[
                                BindGroupEntry {
                                    binding: 0,
                                    resource: BindingResource::TextureView(&view),
                                },
                                BindGroupEntry {
                                    binding: 1,
                                    resource: BindingResource::Sampler(&scaler.sampler),
                                },
                                BindGroupEntry {
                                    binding: 2,
                                    resource: scaler.uniform_buffer.as_entire_binding(),
                                },
                            ],
                        });
                        self.rgba_bind_group = Some(bind_group);
                    }
                    let Some(bind_group) = self.rgba_bind_group.as_ref() else {
                        return self.target_texture_handle.clone();
                    };

                    let target_view = target_texture.create_view(&TextureViewDescriptor::default());
                    let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
                        label: Some("dogmedia-video-scaler-encoder"),
                    });
                    {
                        let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
                            label: Some("dogmedia-video-scaler-pass"),
                            color_attachments: &[Some(RenderPassColorAttachment {
                                view: &target_view,
                                resolve_target: None,
                                depth_slice: None,
                                ops: Operations {
                                    load: wgpu::LoadOp::Clear(Color::BLACK),
                                    store: wgpu::StoreOp::Store,
                                },
                            })],
                            depth_stencil_attachment: None,
                            timestamp_writes: None,
                            occlusion_query_set: None,
                        });
                        pass.set_pipeline(&scaler.pipeline);
                        pass.set_bind_group(0, bind_group, &[]);
                        pass.draw(0..6, 0..1);
                    }
                    queue.submit(Some(encoder.finish()));
                }
            }
        }

        if frame_updated {
            let elapsed = render_started.elapsed();
            if elapsed.as_millis() > 16 {
                tracing::warn!(
                    target: "dogmedia_desktop::video",
                    elapsed_ms = elapsed.as_millis(),
                    "wgpu video render slower than 16ms budget"
                );
            }
        }

        if self.target_texture_handle.is_none() {
            self.ensure_placeholder(ctx)
        } else {
            self.target_texture_handle.clone()
        }
    }
}
