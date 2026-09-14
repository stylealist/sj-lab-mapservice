# sjlabDevDb(PostgreSQL 개발 DB) 연결 확인 및 스키마 분석 보고서

- 분석 대상: PostgreSQL 개발 데이터베이스 (`sjlabDevDb`)
- 설정 참조: `.mcp.json` (`sjlabDevDb`), `.claude/settings.local.json` (`env.SJLAB_DEV_DATABASE_URL`)
- 분석 일시: 2026-09-14
- 쿼리 실행 모드: `BEGIN READ ONLY` 트랜잭션 내 읽기 전용 조회 (SELECT/SHOW만 수행)
- 보안 주의: 접속 비밀번호 및 전체 접속 URL은 본 문서에 일절 기재하지 않음 (호스트 IP 끝자리 마스킹 처리)

---

## 1. 연결 확인 결과

| 항목 | 결과값 | 비고 |
|---|---|---|
| **연결 성공 여부** | **성공 (SUCCESS)** | Node.js (`pg`) 및 Python (`psycopg2`) 직접 연결 검증 |
| **연결 도구** | Node.js `pg` / Python `psycopg2` | Antigravity 내장 Postgres 도구 부재로 직접 접속 |
| **호스트 (접속점)** | `211.188.62.xxx:30017` | 포트포워딩/노드포트 주소 |
| **서버 내부 주소 (`inet_server_addr`)** | `10.244.0.xxx:5432` | 컨테이너/클러스터 내부 IP 및 기본 포트 |
| **접속 데이터베이스 (`current_database`)** | `sjlab` | - |
| **접속 계정 (`current_user`)** | `stylealist` | - |
| **기본 쿼리 테스트 (`SELECT 1`)** | 정상 (`1` 반환) | - |
| **접속 지연 시간 (Connection Latency)** | 약 33 ms | 네트워크 왕복 시간 |
| **단순 쿼리 지연 시간 (Query Latency)** | 약 6 ms | `SELECT 1, version()...` 기준 |
| **PostgreSQL 서버 버전** | `PostgreSQL 17.0 (Debian 17.0-1.pgdg110+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 10.2.1-6) 10.2.1 20210110, 64-bit` | 최신 메이저 버전 17.0 |

---

## 2. 계정 권한 및 읽기 전용 여부 판정

### 2.1 계정 롤(Role) 속성 분석 (`pg_roles`)

| 계정명 | 슈퍼유저 (`rolsuper`) | DB 생성 (`rolcreatedb`) | 롤 생성 (`rolcreaterole`) | 로그인 (`rolcanlogin`) | 복제 (`rolreplication`) | RLS 우회 (`rolbypassrls`) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `stylealist` | **True** | **True** | **True** | **True** | **True** | **True** |

### 2.2 트랜잭션 읽기 전용 설정 분석

- `SHOW default_transaction_read_only` 실행 결과: **`off`**

### 2.3 테이블별 DML 권한 분석 (`has_table_privilege`)

- `ai`, `map`, `public`, `qfield`, `fclt` 등 데이터베이스 내 전체 31개 사용자 테이블 및 뷰에 대해 권한 확인:
  - `SELECT`: **보유 (True)**
  - `INSERT`: **보유 (True)**
  - `UPDATE`: **보유 (True)**
  - `DELETE`: **보유 (True)**

### 2.4 최종 판정 및 보안 권고

- **최종 판정**: **읽기 전용 계정이 아님 (슈퍼유저 권한을 가진 전체 쓰기/관리자 계정)**
- **판정 근거**:
  1. `rolsuper = true`: PostgreSQL 내 모든 보안 검사를 우회할 수 있는 최고 관리자 권한입니다.
  2. `default_transaction_read_only = off`: 기본 세션 연결 시 읽기/쓰기 모드로 동작합니다.
  3. 모든 테이블에 대해 `INSERT`, `UPDATE`, `DELETE`, `DDL` 권한을 완전히 보유하고 있습니다.
- **보안 권고**:
  - `docs/external-services.md`의 규칙("SJLAB_DEV_DATABASE_URL에는 개발/복제 DB의 읽기 전용 계정만 넣을 것. 운영 DB 쓰기 권한 계정을 연결하지 말 것")과 상충됩니다.
  - IDE, MCP 서버 또는 AI 에이전트 도구에서 실수에 의한 데이터 변조/삭제 위험을 차단하기 위해, 별도의 읽기 전용 계정(예: `GRANT SELECT ON ALL TABLES IN SCHEMA ...`, `ALTER ROLE <user> SET default_transaction_read_only = on`)을 생성하여 `.claude/settings.local.json`에 연결할 것을 강력히 권장합니다.

---

## 3. 스키마 및 객체 구성 분석

### 3.1 스키마 목록

| 스키마명 | 소유자 (`schema_owner`) | 역할 및 설명 |
|---|---|---|
| `map` | `stylealist` | 지도 서비스의 핵심 POI 원본 테이블 및 GeoJSON 변환 뷰 |
| `public` | `pg_database_owner` | PostGIS 메타데이터 및 공통 행정구역 경계 데이터(`g_sido`, `g_sgg`, `g_emd`) |
| `ai` | `stylealist` | 부동산 대용량 거래 데이터 (아파트 매매/전월세 실거래가) |
| `fclt` | `stylealist` | 시설물 작업 관리 관련 테이블 (`facility_task`) |
| `qfield` | `stylealist` | QField 모바일 현장 조사 동기화 관련 테이블 및 아카이브 |
| `information_schema` | `stylealist` | PostgreSQL 표준 시스템 메타데이터 카탈로그 |
| `pg_catalog` | `stylealist` | PostgreSQL 내부 시스템 카탈로그 |
| `pg_toast` | `stylealist` | 대형 필드 압축 저장용 TOAST 테이블 카탈로그 |

### 3.2 스키마별 테이블/뷰 수 요약

| 스키마 (`table_schema`) | 테이블 구분 (`table_type`) | 객체 수 |
|---|---|---:|
| `map` | BASE TABLE | 9 |
| `map` | VIEW | 7 |
| `public` | BASE TABLE | 4 |
| `public` | VIEW | 2 |
| `ai` | BASE TABLE | 2 |
| `qfield` | BASE TABLE | 5 |
| `qfield` | VIEW | 1 |
| `fclt` | BASE TABLE | 1 |
| **합계** | **BASE TABLE 21개, VIEW 10개** | **총 31개** |

---

## 4. 행 수 추정치 상위 20개 테이블 (`pg_class.reltuples`)

| 순위 | 스키마 | 테이블/뷰 이름 | 종류 (`relkind`) | 추정 행 수 (`reltuples`) | 용도 및 비고 |
|---:|---|---|:---:|---:|---|
| 1 | `ai` | `apt_rents` | 일반 테이블 (`r`) | 12,022,802 | 아파트 전월세 실거래 내역 |
| 2 | `ai` | `apt_trades` | 일반 테이블 (`r`) | 10,749,853 | 아파트 매매 실거래 내역 |
| 3 | `map` | `bus_stop_info` | 일반 테이블 (`r`) | 206,018 | 전국 버스정류장 정보 (POI) |
| 4 | `map` | `hospital` | 일반 테이블 (`r`) | 77,940 | 병원 정보 (POI) |
| 5 | `map` | `convenience_store` | 일반 테이블 (`r`) | 56,193 | 편의점 정보 (POI) |
| 6 | `map` | `pharmacy` | 일반 테이블 (`r`) | 24,920 | 약국 정보 (POI) |
| 7 | `map` | `bus_route_info` | 일반 테이블 (`r`) | 20,077 | 버스 노선 정보 |
| 8 | `map` | `cctv_info` | 일반 테이블 (`r`) | 12,493 | CCTV 정보 (POI / 영상 스트리밍 URL 포함) |
| 9 | `map` | `government_office` | 일반 테이블 (`r`) | 9,363 | 관공서 정보 (POI) |
| 10 | `public` | `spatial_ref_sys` | 일반 테이블 (`r`) | 8,500 | PostGIS 공간 좌표계 정의 테이블 |
| 11 | `public` | `g_emd` | 일반 테이블 (`r`) | 5,061 | 읍면동 행정구역 경계 폴리곤 |
| 12 | `map` | `facility_info` | 일반 테이블 (`r`) | 4,177 | 공공/체육/복지 시설물 정보 |
| 13 | `qfield` | `stylealist_b43756c7-e175_vfcltinfo_vfcltinfo` | 일반 테이블 (`r`) | 2,473 | QField 현장 점검 조사 테이블 |
| 14 | `public` | `g_sgg` | 일반 테이블 (`r`) | 252 | 시군구 행정구역 경계 폴리곤 |
| 15 | `map` | `bus_city_info` | 일반 테이블 (`r`) | 132 | 버스 운영 도시/지자체 코드 |
| 16 | `public` | `geography_columns` | 뷰 (`v`) | - | PostGIS 지리정보 컬럼 뷰 |
| 17 | `qfield` | `facility_total_view` | 뷰 (`v`) | - | 시설물 종합 통합 뷰 |
| 18 | `public` | `geometry_columns` | 뷰 (`v`) | - | PostGIS 공간 지오메트리 컬럼 뷰 |
| 19 | `map` | `v_government_office_geojson` | 뷰 (`v`) | - | 관공서 GeoJSON FeatureCollection 뷰 |
| 20 | `public` | `g_sido` | 일반 테이블 (`r`) | 17 | 전국 17개 시/도 경계 폴리곤 |

---

## 5. PostGIS 확장 및 공간 컬럼 분석

### 5.1 설치된 확장 (`pg_extension`)

| 확장 이름 | 버전 | 설명 |
|---|---|---|
| `postgis` | **3.4.3** | 공간 지오메트리/지리정보 데이터 타입 및 공간 연산 함수 |
| `pg_trgm` | 1.6 | 텍스트 유사도 검색 및 트라이그램 인덱싱 |
| `plpgsql` | 1.0 | PL/pgSQL 절차 언어 |

- **PostGIS 상세 빌드 정보 (`PostGIS_Full_Version()`)**:
  `POSTGIS="3.4.3 e365945" [EXTENSION] PGSQL="170" GEOS="3.9.0-CAPI-1.16.2" PROJ="7.2.1 NETWORK_ENABLED=OFF URL_ENDPOINT=https://cdn.proj.org USER_WRITABLE_DIRECTORY=/var/lib/postgresql/.local/share/proj DATABASE_PATH=/usr/share/proj/proj.db" LIBXML="2.9.10" LIBJSON="0.15" LIBPROTOBUF="1.3.3" WAGYU="0.5.0 (Internal)"`

### 5.2 등록된 공간 컬럼 목록 (`geometry_columns`)

총 15개의 지오메트리 컬럼이 등록되어 있습니다.

| 스키마 | 테이블/뷰 이름 | 컬럼명 | 차원 | 좌표계 (SRID) | 공간 타입 | 실제 좌표계 및 데이터 특징 |
|---|---|---|:---:|:---:|---|---|
| `map` | `bus_stop_info` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `map` | `cctv_info` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `map` | `convenience_store` | `geom` | 2 | **0** | `GEOMETRY` | DDL 상 SRID=0이나 실제 값은 **EPSG:3857** |
| `map` | `facility_info` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `map` | `government_office` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `map` | `hospital` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `map` | `pharmacy` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `map` | `v_fclt_info` | `geom` | 2 | **3857** | `POINT` | EPSG:3857 (Spherical Mercator) |
| `public` | `g_emd` | `geom` | 2 | **4326** | `MULTIPOLYGON` | WGS84 위경도 (읍면동 경계) |
| `public` | `g_sgg` | `geom` | 2 | **4326** | `MULTIPOLYGON` | WGS84 위경도 (시군구 경계) |
| `public` | `g_sido` | `geom` | 2 | **4326** | `MULTIPOLYGON` | WGS84 위경도 (시도 경계) |
| `qfield` | `facility_deleted_archive` | `geom` | 2 | 0 | `GEOMETRY` | QField 삭제 아카이브 |
| `qfield` | `facility_total_view` | `geom` | 2 | 0 | `GEOMETRY` | 시설물 통합 뷰 |
| `qfield` | `stylealist_41fc...notes` | `geometry` | 2 | 0 | `GEOMETRY` | QField 메모 |
| `qfield` | `stylealist_b437...vfcltinfo` | `geometry` | 2 | 0 | `GEOMETRY` | QField 조사 결과 |

---

## 6. 프론트엔드 POI 연동 테이블/뷰 상세 분석

프론트엔드 코드(`js/modules/map/map-wfs.js`)에서 제공하는 6개 POI 카테고리(`편의점`, `버스정류장`, `CCTV`, `약국`, `병원`, `관공서`)와 데이터베이스 `map` 스키마 내 테이블 및 GeoJSON 뷰가 1:1로 정확하게 일치함을 확인했습니다.

### 6.1 프론트엔드 계층과 DB 매핑 요약

| # | 프론트엔드 레이어명 | UI 명칭 | 프론트 API 엔드포인트 | DB 원본 테이블 | 행 수 | 전용 GeoJSON 뷰 |
|---:|---|---|---|---|---:|---|
| 1 | `convenience_store` | 편의점 | `/map/convenience-store` | `map.convenience_store` | 56,193 | `map.v_convenience_store_geojson` |
| 2 | `bus_stop` | 버스정류장 | `/map/busStop-info` | `map.bus_stop_info` | 206,018 | `map.v_bus_stop_info_geojson` |
| 3 | `cctv` | CCTV | `/map/cctv-info` | `map.cctv_info` | 12,493 | `map.v_cctv_info_geojson` |
| 4 | `pharmacy` | 약국 | `/map/pharmacy-info` | `map.pharmacy` | 24,920 | `map.v_pharmacy_info_geojson` |
| 5 | `hospital` | 병원 | `/map/hospital-info` | `map.hospital` | 77,940 | `map.v_hospital_info_geojson` |
| 6 | `government_office` | 관공서 | `/map/governmentOffice-info` | `map.government_office` | 9,363 | `map.v_government_office_geojson` |

### 6.2 세부 테이블 및 뷰 구조

#### (1) 편의점 (`convenience_store`)
- **테이블**: `map.convenience_store`
- **컬럼 구성**: `objt_id` (bigint, PK), `fclty_cd` (text), `fclty_nm` (text, 브랜드명), `adres` (text), `rn_adres` (text), `sgg_cd` (text), `emd_cd` (text), `ctprvn_cd` (text), `telno` (text), `fclty_ty` (text), `data_yr` (int), `x` (float8), `y` (float8), `raw` (jsonb), `geom` (geometry)
- **뷰 구현 (`map.v_convenience_store_geojson`)**:
  - `DISTINCT ON (x, y)`로 중복 좌표 제거
  - `ST_AsGeoJSON(geom)`으로 GeoJSON Feature 생성 (`id: map:convenience_store.<objt_id>`)
  - `json_build_object('type', 'FeatureCollection', ...)` 형태로 완제품 GeoJSON 반환

#### (2) 버스정류장 (`bus_stop`)
- **테이블**: `map.bus_stop_info`
- **연관 테이블**: `map.bus_route_info` (20,077건의 노선 데이터), `map.bus_city_info` (132건의 도시 코드)
- **컬럼 구성**: `id` (bigint, PK), `city_mgmt_name` (text, 관리지자체), `city_name` (text, 도시명), `city_code` (int), `mobile_short_no` (int, 정류장 단축번호), `stop_name` (text, 정류장명), `stop_code` (text, 정류장ARS/고유번호), `lon` (float8), `lat` (float8), `collected_on` (date), `geom` (geometry)
- **뷰 구현 (`map.v_bus_stop_info_geojson`)**:
  - `DISTINCT ON (lon, lat)`로 중복 정류장 위치 필터링
  - 속성에 `city_mgmt_name`, `city_name`, `stop_name`, `stop_code` 등을 담아 FeatureCollection으로 변환

#### (3) CCTV (`cctv`)
- **테이블**: `map.cctv_info`
- **컬럼 구성**: `id` (bigint, PK), `coord_type` (text), `data_count` (int), `road_section_id` (text), `file_create_time` (timestamp), `cctv_type` (int2), `cctv_url` (text, HLS/RTSP/RTMP 스트리밍 주소), `cctv_resolution` (text), `coordx` (float8), `coordy` (float8), `cctv_format` (text), `cctv_name` (text), `geom` (geometry)
- **뷰 구현 (`map.v_cctv_info_geojson`)**:
  - `DISTINCT ON (coordx, coordy)`로 중복 위치 필터링
  - `cctv_url`, `cctv_name`, `cctv_type` 등을 Feature properties에 포함하여 프론트엔드 HLS 영상 재생 팝업(`map-wfs.js:1371~1430`)과 직접 연동

#### (4) 약국 (`pharmacy`)
- **테이블**: `map.pharmacy`
- **컬럼 구성**: `id` (bigint, PK), `hpid` (varchar, 기관식별자), `duty_name` (varchar, 약국명), `duty_addr` (text, 주소), `duty_tel1` (varchar, 전화번호), `duty_fax` (varchar), `duty_time1s` ~ `duty_time6c` (월~토 진료/영업 시작·종료시간), `wgs84_lon` (float8), `wgs84_lat` (float8), `geom` (geometry)
- **뷰 구현 (`map.v_pharmacy_info_geojson`)**:
  - `DISTINCT ON (wgs84_lon, wgs84_lat)` 적용
  - 프론트엔드 팝업(`map-wfs.js:1255~1295`)의 요일별 진료시간 표시를 위한 `duty_time*` 전체 컬럼이 포함됨

#### (5) 병원 (`hospital`)
- **테이블**: `map.hospital`
- **컬럼 구성**: `id` (bigint, PK), `hpid` (varchar, 기관식별자), `duty_name` (varchar, 병원명), `duty_addr` (text), `duty_tel1` (varchar), `duty_div` (varchar, 병원분류), `duty_div_nam` (varchar, 의원/종합병원/치과의원 등), `duty_emcls` (varchar), `duty_emcls_name` (varchar, 응급의료기관 구분), `duty_eryn` (varchar, 응급실 운영여부), `duty_time1s` ~ `duty_time7c` (월~일/공휴일 진료시간), `wgs84_lon` (float8), `wgs84_lat` (float8), `geom` (geometry)
- **뷰 구현 (`map.v_hospital_info_geojson`)**:
  - `DISTINCT ON (wgs84_lon, wgs84_lat)` 적용
  - 프론트엔드 팝업(`map-wfs.js:1296~1370`)의 응급실 정보(`duty_emcls_name`), 진료과목, 운영시간 필드 완벽 매핑

#### (6) 관공서 (`government_office`)
- **테이블**: `map.government_office`
- **컬럼 구성**: `id` (bigint, PK), `objt_id` (numeric), `fclty_ty` (varchar, 시설유형), `fclty_cd` (varchar), `fclty_nm` (varchar, 관공서명), `adres` (varchar), `rn_adres` (varchar), `telno` (varchar), `ctprvn_cd` (varchar), `sgg_cd` (varchar), `emd_cd` (varchar), `x_coord` (float8), `y_coord` (float8), `data_yr` (varchar), `geom` (geometry)
- **뷰 구현 (`map.v_government_office_geojson`)**:
  - `DISTINCT ON (x_coord, y_coord)` 적용
  - 프론트엔드 팝업(`map-wfs.js:1210~1254`)의 시설명, 주소, 전화번호 속성 지원

---

## 7. 주요 발견 사항 및 기술적 시사점

1. **백엔드 API와 DB 뷰의 직결 구조**:
   - 백엔드(`/map/*-info` 및 `/map/convenience-store`)는 복잡한 애플리케이션 레벨 변환 대신, DB의 `map.v_*_geojson` 뷰에서 생성한 완성형 `FeatureCollection`을 그대로 프론트엔드로 전달하는 구조로 설계되어 있습니다.
   - 뷰 내부에서 `DISTINCT ON`을 통해 동일 좌표상의 데이터 중복을 사전에 제거하고 있습니다.

2. **좌표계 및 컬럼명 불일치 주의**:
   - `map.hospital`과 `map.pharmacy`의 컬럼명은 `wgs84_lon`, `wgs84_lat`으로 명명되어 있으나, 실제 저장된 좌표값은 경위도(약 127/37)가 아니라 **EPSG:3857 구면 메르카토르 좌표**(약 14,263,229 / 4,186,427)입니다.
   - `map.convenience_store.geom`의 메타데이터 SRID는 0으로 지정되어 있으나, 실제 지오메트리 객체 내부의 SRID 및 좌표값은 EPSG:3857입니다.
   - 반면 `public.g_emd`, `public.g_sgg`, `public.g_sido` 행정경계 데이터는 표준 WGS84(`EPSG:4326`) 경위도로 저장되어 있으므로, POI와 공간 조인(Spatial Join) 연산 시 `ST_Transform()` 변환이 필수적입니다.

3. **권한 분리 필요성**:
   - 현재 `.claude/settings.local.json`에 등록된 `stylealist` 계정은 슈퍼유저 및 DML/DDL 권한을 모두 가진 관리자 계정입니다.
   - 개발 및 MCP 연동 환경의 안전을 위해 읽기 전용 계정으로의 교체가 시급합니다.

---

## 8. 읽기 전용 계정 재점검 (2026-09-14)

사용자가 `.claude/settings.local.json`의 `SJLAB_DEV_DATABASE_URL`을 신규 읽기 전용 계정(`mcp_readonly`)으로 교체함에 따라, 계정 권한 및 기능 정상 작동 여부에 대한 재점검을 수행했습니다.

### 8.1 재점검 개요 및 접속 확인

| 항목 | 결과값 | 비고 |
|---|---|---|
| **연결 성공 여부** | **성공 (SUCCESS)** | 신규 `mcp_readonly` 계정 접속 확인 |
| **접속 계정 (`current_user`)** | `mcp_readonly` | 신규 계정 적용 확인 |
| **접속 데이터베이스 (`current_database`)** | `sjlab` | - |
| **호스트/포트** | `211.188.62.xxx:30017` (내부 `10.244.0.xxx:5432`) | 내부 포트 5432 |
| **접속 지연 시간 (Connection Latency)** | 약 615 ms | 네트워크 초기 핸드셰이크 |
| **단순 쿼리 지연 시간 (Query Latency)** | 약 20 ms | `SELECT 1, version()...` 기준 |
| **기본 쿼리 테스트 (`SELECT 1`)** | 정상 (`1` 반환) | - |

---

### 8.2 읽기 전용 판정 및 상세 분석

- **최종 판정: 읽기 전용 판정: 예 (완전한 읽기 전용 계정)**

#### 1) 롤 속성 분석 (`pg_roles`)
- `rolname`: `mcp_readonly`
- `rolsuper`: **`false`** (슈퍼유저 권한 없음)
- `rolcreatedb`: **`false`** (DB 생성 불가)
- `rolcreaterole`: **`false`** (롤 생성 불가)
- `rolcanlogin`: **`true`** (로그인 허용)
- `rolreplication`: **`false`** (복제 권한 없음)
- `rolbypassrls`: **`false`** (RLS 보안 우회 불가)

#### 2) 기본 트랜잭션 읽기 전용 설정
- `SHOW default_transaction_read_only`: **`on`**
- `pg_db_role_setting` 확인: `mcp_readonly` 역할에 대해 전역 `default_transaction_read_only=on`이 영구 설정되어 있음.

#### 3) 역할 멤버십 (`pg_auth_members` / `pg_has_role`)
- 상속된 시스템 롤: `['pg_read_all_data']`
- `pg_read_all_data`: **`true`** (전체 데이터 자동 읽기 권한)
- `pg_write_all_data`: **`false`** (쓰기 롤 없음)
- 기타 슈퍼유저 또는 쓰기 가능 역할 상속: **전혀 없음**

#### 4) 데이터베이스 및 스키마 권한
- `has_database_privilege`:
  - `CONNECT`: **`true`**
  - `CREATE`: **`false`** (DB 내 신규 스키마 생성 차단)
  - `TEMP`: **`true`** (임시 테이블 생성 허용)
- 사용자 스키마(`map`, `public`, `ai`, `qfield`, `fclt`) 권한:
  - `USAGE`: 전체 5개 스키마 모두 **`true`** (조회 가능)
  - `CREATE`: 전체 5개 스키마 모두 **`false`** (스키마 내 신규 객체 생성 차단)

#### 5) 테이블/뷰별 DML 권한 집계 (`has_table_privilege`)
사용자 스키마(`map`, `public`, `ai`, `qfield`, `fclt`) 내 전체 31개 테이블/뷰 대상:
- `SELECT` 가능 객체 수: **31개 (100%)**
- `INSERT` 가능 객체 수: **0개**
- `UPDATE` 가능 객체 수: **0개**
- `DELETE` 가능 객체 수: **0개**
- `TRUNCATE` 가능 객체 수: **0개**
- **쓰기 권한 보유 객체 수: 0개 (완전 차단)**

---

### 8.3 이전 계정(`stylealist`) vs 신규 계정(`mcp_readonly`) 비교표

2.4절 및 7장 3항에서 제기된 보안 위험 및 권고사항이 완벽하게 해결되었음을 확인했습니다.

| 검증 항목 | 이전 계정 (`stylealist`) | 신규 계정 (`mcp_readonly`) | 개선 및 보안 효과 |
|---|:---:|:---:|---|
| **슈퍼유저 여부 (`rolsuper`)** | `true` (위험) | **`false`** | 시스템 카탈로그 및 RLS 우회 불가 |
| **세션 기본 트랜잭션** | `off` (읽기/쓰기 모드) | **`on` (READ ONLY)** | 우발적 DML 실행 원천 차단 |
| **역할 상속** | 최고 관리자 | **`pg_read_all_data`** | 전역 자동 읽기 권한만 안전하게 보유 |
| **테이블 쓰기 권한 (`INSERT/UPDATE/DELETE`)** | 31개 전체 보유 | **0개 (완전 제거)** | 테이블 데이터 변조/삭제 불가 |
| **테이블 잘라내기 (`TRUNCATE`)** | 보유 | **0개 (완전 제거)** | 대량 데이터 삭제 위험 차단 |
| **스키마 내 객체 생성 (`CREATE`)** | 전체 허용 | **전체 차단 (`false`)** | 임의 DDL 객체 생성 불가 |
| **보안 가이드(`docs/external-services.md`) 준수** | 미준수 | **완벽 준수** | AI/MCP 도구에 안전한 개발 환경 확립 |

---

### 8.4 기능 정상 작동 검증

신규 계정으로 기존 분석 및 프론트엔드가 요구하는 데이터 조회가 정상적으로 수행되는지 검증했습니다.

1. **POI 6개 테이블 행 수 추정치 (`pg_class.reltuples`) 조회**:
   - `map.bus_stop_info`: **206,018** 행 (정상)
   - `map.hospital`: **77,940** 행 (정상)
   - `map.convenience_store`: **56,193** 행 (정상)
   - `map.pharmacy`: **24,920** 행 (정상)
   - `map.cctv_info`: **12,493** 행 (정상)
   - `map.government_office`: **9,363** 행 (정상)
   - **결과**: 6개 테이블 모두 오류 없이 즉시 조회됨.

2. **공간 컬럼 메타데이터 (`geometry_columns`) 조회**:
   - `map`, `public`, `qfield` 스키마 내 15개 공간 지오메트리 컬럼 메타데이터 정상 조회 완료.

3. **GeoJSON 뷰 SELECT 테스트 (`map.v_cctv_info_geojson`)**:
   - 쿼리: `SELECT length(geojson::text) FROM map.v_cctv_info_geojson`
   - **결과**: **1행 정상 반환** (GeoJSON 문자열 길이: **6,637,478자**)
   - 프론트엔드 연동용 GeoJSON FeatureCollection 생성 기능이 완벽하게 작동함을 확인.

4. **권한 부족으로 실패한 객체 목록**:
   - **`없음 (0건)`**: 사용자 스키마 내 조회 필요한 모든 객체(31개)에 대해 100% 정상 접근 가능.

