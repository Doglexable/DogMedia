%global debug_package %{nil}
%{!?dogmedia_version:%global dogmedia_version 0.1.0}

Name:           dogmedia-desktop
Version:        %{dogmedia_version}
Release:        1%{?dist}
Summary:        Native desktop client for Dogmedia
License:        MIT
URL:            https://github.com/Doglexable/Dogmedia
Source0:        dogmedia-desktop
Source1:        com.dogmedia.Desktop.desktop
Source2:        com.dogmedia.Desktop.metainfo.xml
Source3:        com.dogmedia.Desktop.svg
Source4:        LICENSE

Requires:       gtk4 >= 4.16
Requires:       libadwaita >= 1.6
Requires:       gstreamer1 >= 1.24
Requires:       gstreamer1-plugin-gtk4
Requires:       gstreamer1-plugins-base
Requires:       gstreamer1-plugins-good
Requires:       ca-certificates
Recommends:     gstreamer1-plugins-bad-free
Recommends:     gstreamer1-plugin-libav

%description
Browse photos, music, and videos from a self-hosted Dogmedia server using a
native GTK interface and GStreamer playback, without an embedded browser.

%prep

%build

%install
install -Dm0755 %{SOURCE0} %{buildroot}%{_bindir}/dogmedia-desktop
install -Dm0644 %{SOURCE1} %{buildroot}%{_datadir}/applications/com.dogmedia.Desktop.desktop
install -Dm0644 %{SOURCE2} %{buildroot}%{_metainfodir}/com.dogmedia.Desktop.metainfo.xml
install -Dm0644 %{SOURCE3} %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/com.dogmedia.Desktop.svg
install -Dm0644 %{SOURCE4} %{buildroot}%{_licensedir}/%{name}/LICENSE

%files
%license %{_licensedir}/%{name}/LICENSE
%{_bindir}/dogmedia-desktop
%{_datadir}/applications/com.dogmedia.Desktop.desktop
%{_metainfodir}/com.dogmedia.Desktop.metainfo.xml
%{_datadir}/icons/hicolor/scalable/apps/com.dogmedia.Desktop.svg

%changelog
* Wed Sep 30 2026 Dogmedia <support@dogmedia.invalid> - %{dogmedia_version}-1
- Initial native desktop package
