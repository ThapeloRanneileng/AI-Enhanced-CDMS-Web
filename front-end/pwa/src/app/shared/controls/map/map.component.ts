import { Component, AfterViewInit, Input, SimpleChanges, OnChanges } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ClimsoftBoundaryModel } from 'src/app/admin/general-settings/models/settings/climsoft-boundary.model';
import * as L from 'leaflet';
import { SettingIdEnum } from 'src/app/admin/general-settings/models/setting-id.enum';
import { CachedMetadataService } from 'src/app/metadata/metadata-updates/cached-metadata.service';

const LESOTHO_DEFAULT_CENTER: [number, number] = [-29.61, 28.23];
const LESOTHO_DEFAULT_ZOOM = 8;
const LESOTHO_MIN_FINAL_ZOOM = 9;
const LESOTHO_LATITUDE_RANGE: readonly [number, number] = [-30.7, -28.4];
const LESOTHO_LONGITUDE_RANGE: readonly [number, number] = [27.0, 29.7];

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements AfterViewInit, OnChanges {
  @Input() public mapHeight: string = '80vh';
  @Input() public contentLayersGroup!: L.LayerGroup;

  // Generate a random map id to make user it's alway unique
  protected mapContainerId: string = `map_${Math.random().toString()}`;

  // Create the overall content layer group. This contains all other layers displayed on the map.
  private allLayersGroup: L.LayerGroup = L.layerGroup();

  // Create the climsoft boundary layer group to show the boundaries of climsoft operations 
  // private boundaryMapLayerGroup: L.LayerGroup = L.layerGroup();

  protected climsoftBoundary!: ClimsoftBoundaryModel;
  private map!: L.Map;

  private destroy$ = new Subject<void>();

  constructor(private cachedMetadataService: CachedMetadataService) { }

  ngAfterViewInit(): void {
    // Load the climsoft boundary setting.
    this.cachedMetadataService.allMetadataLoaded.pipe(
      takeUntil(this.destroy$),
    ).subscribe(allMetadataLoaded => {
      if (!allMetadataLoaded) return;
      const boundarySetting = this.cachedMetadataService.getGeneralSetting(SettingIdEnum.CLIMSOFT_BOUNDARY);
      this.climsoftBoundary = boundarySetting?.parameters as ClimsoftBoundaryModel;
      // Settting of the map has been done under the `setTimeout` because 
      // leaflet throws an error of map container not found
      // when this component is used in a dialog like the station search dialog.
      // As of 08/09/2025, its not clear why the map container is not being found considering
      // `setupMap` is being called under `ngAfterViewInit`
      setTimeout(() => {
        this.setupMap();
      }, 0);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contentLayersGroup'] && this.contentLayersGroup) {
      this.allLayersGroup.clearLayers();
      this.contentLayersGroup.addTo(this.allLayersGroup);
      this.fitMapToContentLayers();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupMap(): void {
    // Only set up the map when the container id has been given
    // If the map has already been set up, then no need to set it up again
    if (!(this.mapContainerId && !this.map)) {
      return;
    }

    const initialCenter = this.getInitialCenter();
    const initialZoom = this.getInitialZoom();

    // create the leaflet map
    this.map = L.map(this.mapContainerId).setView(
      initialCenter,
      initialZoom); // Set initial coordinates and zoom level

    // Remove ukraine flag
    this.map.attributionControl.setPrefix('');

    // Add OpenStreetMap tile layer
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(this.map);


    // If boundary coordinates provided, then add them to the boundary layer for visibility
    // if (this.climsoftBoundary.boundary) {
    //   const multipolygon = turf.multiPolygon(this.climsoftBoundary.boundary);
    //   L.geoJSON(multipolygon, {
    //     style: { fillColor: 'transparent', color: '#1330BF', weight: 0.5 }, // "opacity": 0.5 
    //   }).addTo(this.boundaryMapLayerGroup);
    // }

    // Add content layer group to the map
    this.allLayersGroup.addTo(this.map);
    this.fitMapToContentLayers();

  }

  private getInitialCenter(): [number, number] {
    if (this.hasLesothoBoundaryCenter()) {
      return [this.climsoftBoundary.latitude, this.climsoftBoundary.longitude];
    }

    return LESOTHO_DEFAULT_CENTER;
  }

  private getInitialZoom(): number {
    if (this.hasLesothoBoundaryCenter() && Number.isFinite(this.climsoftBoundary.zoomLevel)) {
      return this.climsoftBoundary.zoomLevel;
    }

    return LESOTHO_DEFAULT_ZOOM;
  }

  private fitMapToContentLayers(): void {
    if (!this.map || !this.contentLayersGroup) {
      return;
    }

    const boundsProvider = this.contentLayersGroup as L.LayerGroup & { getBounds?: () => L.LatLngBounds };
    const groupBounds = boundsProvider.getBounds?.();
    if (!groupBounds || !groupBounds.isValid()) {
      this.map.setView(this.getInitialCenter(), this.getInitialZoom());
      return;
    }

    this.map.fitBounds(groupBounds, { padding: [12, 12], maxZoom: 10 });
    if (this.shouldUseMinimumLesothoZoom(groupBounds) && this.map.getZoom() < LESOTHO_MIN_FINAL_ZOOM) {
      this.map.setZoom(LESOTHO_MIN_FINAL_ZOOM);
    }
  }

  private hasLesothoBoundaryCenter(): boolean {
    return !!(this.climsoftBoundary
      && Number.isFinite(this.climsoftBoundary.latitude)
      && Number.isFinite(this.climsoftBoundary.longitude)
      && this.isInLesothoViewport(this.climsoftBoundary.latitude, this.climsoftBoundary.longitude));
  }

  private shouldUseMinimumLesothoZoom(bounds: L.LatLngBounds): boolean {
    const center = bounds.getCenter();
    return this.isInLesothoViewport(center.lat, center.lng);
  }

  private isInLesothoViewport(latitude: number, longitude: number): boolean {
    return latitude >= LESOTHO_LATITUDE_RANGE[0]
      && latitude <= LESOTHO_LATITUDE_RANGE[1]
      && longitude >= LESOTHO_LONGITUDE_RANGE[0]
      && longitude <= LESOTHO_LONGITUDE_RANGE[1];
  }

}
